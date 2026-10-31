"""Recurring billing engine: period maths, discount application, tax, invoice creation.

Guarantees:
  * nothing is billed twice  - (subscription_id, period_start) is unique in the database and
    checked before every insert;
  * nothing is skipped       - run_billing() catches up every period that has fallen due.
"""
import calendar
import uuid
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from .models import Discount, Invoice, InvoiceLine, Plan, Subscription


# ------------------------------------------------------------------ period maths
def add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def add_period(d: date, period: str, n: int = 1) -> date:
    if period == "daily":
        return d + timedelta(days=n)
    if period == "weekly":
        return d + timedelta(weeks=n)
    if period == "monthly":
        return add_months(d, n)
    if period == "yearly":
        return add_months(d, 12 * n)
    raise ValueError(f"Unknown billing period {period}")


def period_bounds(sub: Subscription, k: int):
    """Period k is always computed from the start date, so month-end dates never drift."""
    start = add_period(sub.start_date, sub.plan.billing_period, k)
    end = add_period(sub.start_date, sub.plan.billing_period, k + 1) - timedelta(days=1)
    return start, end


def next_due(sub: Subscription) -> Optional[date]:
    d = add_period(sub.start_date, sub.plan.billing_period, sub.periods_billed)
    if sub.expiry_date and d > sub.expiry_date:
        return None
    return d


def money(x: float) -> float:
    return round(x + 0.0, 2)


# ------------------------------------------------------------------ discounts
def _matching_discounts(db: Session, sub: Subscription, today: date):
    q = db.query(Discount).filter(
        Discount.active.is_(True),
        or_(Discount.start_date.is_(None), Discount.start_date <= today),
        or_(Discount.end_date.is_(None), Discount.end_date >= today),
        or_(Discount.subscription_id.is_(None), Discount.subscription_id == sub.id),
    )
    return [d for d in q.order_by(Discount.id).all()
            if d.usage_limit is None or d.times_used < d.usage_limit]


def _apply_discounts(db: Session, sub: Subscription, items: list[dict], today: date):
    """Adds a 'discount' amount to each item. Returns names of the discounts that applied."""
    applied = []
    for d in _matching_discounts(db, sub, today):
        if d.applies_to == "product":
            targets = [i for i in items if i["product_id"] == d.product_id]
        else:
            targets = items
        gross = sum(i["amount"] for i in targets)
        qty = sum(i["quantity"] for i in targets if i["product_id"] is not None)
        net = sum(i["amount"] - i["discount"] for i in targets)
        if not targets or net <= 0 or gross < (d.min_purchase or 0) or qty < (d.min_quantity or 0):
            continue
        amount = net * d.value / 100 if d.kind == "percent" else min(d.value, net)
        amount = money(min(amount, net))
        remaining = amount
        for n, it in enumerate(targets):
            line_net = it["amount"] - it["discount"]
            share = remaining if n == len(targets) - 1 else money(amount * line_net / net)
            share = min(share, line_net, remaining)
            it["discount"] = money(it["discount"] + share)
            remaining = money(remaining - share)
        d.times_used += 1
        applied.append(d.name)
    return applied


# ------------------------------------------------------------------ invoice creation
def generate_invoice(db: Session, sub: Subscription, today: date) -> Optional[Invoice]:
    k = sub.periods_billed
    p_start, p_end = period_bounds(sub, k)
    if db.query(Invoice.id).filter_by(subscription_id=sub.id, period_start=p_start).first():
        return None  # already billed - never twice

    items: list[dict] = []
    if sub.plan.price > 0:
        items.append(dict(description=f"{sub.plan.name} plan fee", product_id=None, quantity=1,
                          unit_price=sub.plan.price, tax_rate=0.0))
    for l in sub.lines:
        label = l.product.name + (f" ({l.variant.attribute}: {l.variant.value})" if l.variant else "")
        items.append(dict(description=label, product_id=l.product_id, quantity=l.quantity,
                          unit_price=l.unit_price, tax_rate=l.tax.rate_percent if l.tax else 0.0))
    for it in items:
        it["amount"] = money(it["quantity"] * it["unit_price"])
        it["discount"] = 0.0

    applied = _apply_discounts(db, sub, items, today)

    inv = Invoice(number=f"TMP-{uuid.uuid4().hex}", subscription_id=sub.id, customer_id=sub.customer_id,
                  period_start=p_start, period_end=p_end, issue_date=today,
                  due_date=today + timedelta(days=sub.payment_terms_days or 0),
                  status="draft", discount_note=", ".join(applied))
    subtotal = discount = tax = 0.0
    for it in items:
        net = it["amount"] - it["discount"]
        t = money(net * it["tax_rate"] / 100)
        inv.lines.append(InvoiceLine(description=it["description"], quantity=it["quantity"],
                                     unit_price=it["unit_price"], tax_rate=it["tax_rate"],
                                     amount=it["amount"], discount_amount=it["discount"],
                                     tax_amount=t, line_total=money(net + t)))
        subtotal += it["amount"]
        discount += it["discount"]
        tax += t
    inv.subtotal, inv.discount_total, inv.tax_total = money(subtotal), money(discount), money(tax)
    inv.total = money(subtotal - discount + tax)
    db.add(inv)
    db.flush()
    inv.number = f"INV-{inv.id:06d}"
    return inv


def bill_subscription(db: Session, sub: Subscription, today: date) -> list[Invoice]:
    """Create every invoice that has fallen due for one subscription (catch-up safe)."""
    created = []
    guard = 0
    while sub.next_invoice_date and sub.next_invoice_date <= today and guard < 600:
        guard += 1
        inv = generate_invoice(db, sub, today)
        if inv:
            created.append(inv)
        sub.periods_billed += 1
        sub.next_invoice_date = next_due(sub)
    return created


def housekeeping(db: Session, today: date) -> int:
    """Plans that auto-close end on their end date; their finished subscriptions close too."""
    for p in db.query(Plan).filter(Plan.auto_close.is_(True), Plan.end_date.isnot(None),
                                   Plan.end_date < today, Plan.status != "closed"):
        p.status = "closed"
    closed = 0
    q = (db.query(Subscription).options(joinedload(Subscription.plan))
         .filter(Subscription.status == "active", Subscription.expiry_date.isnot(None),
                 Subscription.expiry_date < today, Subscription.next_invoice_date.is_(None)))
    for s in q:
        if s.plan.auto_close:
            s.status = "closed"
            closed += 1
    return closed


def run_billing(db: Session, today: Optional[date] = None) -> dict:
    today = today or date.today()
    subs = (db.query(Subscription).options(joinedload(Subscription.plan), joinedload(Subscription.lines))
            .filter(Subscription.status == "active", Subscription.next_invoice_date.isnot(None),
                    Subscription.next_invoice_date <= today).all())
    created = 0
    for s in subs:
        created += len(bill_subscription(db, s, today))
    closed = housekeeping(db, today)
    db.commit()
    return {"subscriptions_processed": len(subs), "invoices_created": created, "subscriptions_closed": closed}
