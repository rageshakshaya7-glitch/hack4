"""PART 5 - Subscription creation: quotes from templates, lifecycle, pause/close/renew."""
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from .. import billing as bl
from ..db import get_db
from ..deps import current_user, my_customer_id, paginate, ser
from ..models import (Customer, Plan, Product, Subscription, SubscriptionLine, Template, User, Variant)

router = APIRouter(prefix="/api", tags=["subscriptions"])

# Draft -> Quotation -> Confirmed -> Active -> Closed (paused is a side state of active)
FLOW = {
    "draft": ["quotation"],
    "quotation": ["confirmed", "draft"],
    "confirmed": ["active"],
    "active": ["closed", "paused"],
    "paused": ["active", "closed"],
    "closed": [],
}
CUSTOMER_MOVES = {("active", "paused"), ("paused", "active"), ("active", "closed"), ("paused", "closed")}


class LineIn(BaseModel):
    product_id: int
    variant_id: Optional[int] = None
    quantity: int = 1
    unit_price: Optional[float] = None
    tax_id: Optional[int] = None


class SubIn(BaseModel):
    customer_id: int
    plan_id: Optional[int] = None
    template_id: Optional[int] = None
    start_date: date
    expiry_date: Optional[date] = None
    payment_terms_days: int = 15
    notes: str = ""
    lines: List[LineIn] = []


class TransitionIn(BaseModel):
    to: str


def build_lines(db: Session, plan: Plan, lines: List[LineIn]) -> List[SubscriptionLine]:
    if not lines:
        raise HTTPException(400, "Add at least one product line")
    out = []
    for l in lines:
        product = db.get(Product, l.product_id)
        if not product:
            raise HTTPException(400, f"Product {l.product_id} not found")
        if l.quantity < plan.min_quantity:
            raise HTTPException(400, f"Minimum quantity for plan '{plan.name}' is {plan.min_quantity}")
        extra = 0.0
        if l.variant_id:
            v = db.get(Variant, l.variant_id)
            if not v or v.product_id != product.id:
                raise HTTPException(400, "Variant does not belong to that product")
            extra = v.extra_price
        price = l.unit_price if l.unit_price is not None else product.sales_price + extra
        out.append(SubscriptionLine(product_id=product.id, variant_id=l.variant_id, quantity=l.quantity,
                                    unit_price=price, tax_id=l.tax_id if l.tax_id is not None else product.tax_id,
                                    amount=bl.money(price * l.quantity)))
    return out


def sub_total(s: Subscription) -> float:
    return bl.money(sum(l.amount for l in s.lines) + s.plan.price)


def sub_out(s: Subscription, detail: bool = False) -> dict:
    d = ser(s, customer_name=s.customer.name, plan_name=s.plan.name, billing_period=s.plan.billing_period,
            total_per_period=sub_total(s))
    if detail:
        d["lines"] = [ser(l, product_name=l.product.name,
                          variant_name=f"{l.variant.attribute}: {l.variant.value}" if l.variant else None,
                          tax_name=l.tax.name if l.tax else None) for l in s.lines]
        d["plan"] = ser(s.plan)
    return d


def load_sub(db: Session, sid: int, user: User) -> Subscription:
    s = (db.query(Subscription).options(joinedload(Subscription.lines), joinedload(Subscription.plan),
                                        joinedload(Subscription.customer)).filter_by(id=sid).first())
    if not s:
        raise HTTPException(404, "Subscription not found")
    if user.role == "customer" and s.customer_id != my_customer_id(user, db):
        raise HTTPException(404, "Subscription not found")  # customers only see their own
    return s


@router.get("/subscriptions")
def list_subscriptions(status: Optional[str] = None, customer_id: Optional[int] = None, q: Optional[str] = None,
                       page: int = 1, page_size: int = Query(50, le=200),
                       db: Session = Depends(get_db), user: User = Depends(current_user)):
    query = (db.query(Subscription).options(joinedload(Subscription.customer), joinedload(Subscription.plan),
                                            joinedload(Subscription.lines))
             .order_by(Subscription.id.desc()))
    if user.role == "customer":
        customer_id = my_customer_id(user, db)
    if customer_id:
        query = query.filter(Subscription.customer_id == customer_id)
    if status:
        query = query.filter(Subscription.status == status)
    if q:
        query = query.filter(Subscription.number.ilike(f"%{q}%"))
    total, items, page, size = paginate(query, page, page_size)
    return {"total": total, "page": page, "page_size": size, "items": [sub_out(s) for s in items]}


@router.get("/subscriptions/{sid}")
def get_subscription(sid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return sub_out(load_sub(db, sid, user), detail=True)


@router.post("/subscriptions")
def create_subscription(body: SubIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if user.role == "customer":
        raise HTTPException(403, "Customers cannot create subscriptions")
    if not db.get(Customer, body.customer_id):
        raise HTTPException(400, "Customer not found")
    template = db.get(Template, body.template_id) if body.template_id else None
    plan = db.get(Plan, body.plan_id or (template.plan_id if template else 0))
    if not plan:
        raise HTTPException(400, "Choose a plan (or a template that has one)")
    if plan.status != "open":
        raise HTTPException(400, f"Plan '{plan.name}' is {plan.status} and cannot take new subscriptions")
    if (plan.start_date and body.start_date < plan.start_date) or (plan.end_date and body.start_date > plan.end_date):
        raise HTTPException(400, "Start date is outside the dates this plan is available")
    if body.expiry_date and body.expiry_date < body.start_date:
        raise HTTPException(400, "Expiry date is before the start date")

    # start from a template: its lines are copied unless the rep supplied their own
    line_inputs = body.lines or ([LineIn(product_id=t.product_id, variant_id=t.variant_id, quantity=t.quantity)
                                  for t in template.lines] if template else [])
    s = Subscription(number="TMP", customer_id=body.customer_id, plan_id=plan.id,
                     template_id=template.id if template else None, status="draft",
                     start_date=body.start_date, expiry_date=body.expiry_date,
                     payment_terms_days=body.payment_terms_days, notes=body.notes, created_by=user.id,
                     quotation_valid_until=(date.today() + timedelta(days=template.validity_days)) if template else None)
    s.lines = build_lines(db, plan, line_inputs)
    db.add(s)
    db.flush()
    s.number = f"SUB-{s.id:06d}"
    db.commit()
    return sub_out(load_sub(db, s.id, user), detail=True)


@router.post("/subscriptions/{sid}/transition")
def transition(sid: int, body: TransitionIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = load_sub(db, sid, user)
    frm, to = s.status, body.to
    if to not in FLOW.get(frm, []):
        raise HTTPException(400, f"Cannot move a {frm} subscription to {to}")
    if user.role == "customer" and (frm, to) not in CUSTOMER_MOVES:
        raise HTTPException(403, "You can only pause, resume or close your own active subscription")
    today = date.today()
    if to == "confirmed" and s.quotation_valid_until and s.quotation_valid_until < today:
        raise HTTPException(400, "This quotation has expired")
    if to == "paused":
        if not s.plan.allow_pause:
            raise HTTPException(400, "This plan cannot be paused")
        bl.bill_subscription(db, s, today)  # settle anything already due before pausing
    if to == "closed" and frm in ("active", "paused"):
        expired = s.expiry_date and s.expiry_date < today
        if not (s.plan.allow_early_close or expired):
            raise HTTPException(400, "This plan cannot be closed early")
    if to == "active":
        if frm == "confirmed":
            s.periods_billed = 0
            s.next_invoice_date = bl.next_due(s)
        elif frm == "paused":
            # periods that ended while paused are not billed
            while s.expiry_date is None or bl.next_due(s):
                nd = bl.next_due(s)
                if nd is None or bl.period_bounds(s, s.periods_billed)[1] >= today:
                    break
                s.periods_billed += 1
            s.next_invoice_date = bl.next_due(s)
    s.status = to
    db.commit()
    return sub_out(load_sub(db, sid, user), detail=True)


@router.post("/subscriptions/{sid}/renew")
def renew(sid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Extend the expiry by one billing period (and reactivate a closed subscription)."""
    if user.role == "customer":
        raise HTTPException(403, "Please contact the team to renew")
    s = load_sub(db, sid, user)
    if not s.plan.allow_renew:
        raise HTTPException(400, "This plan cannot be renewed")
    if s.status not in ("active", "closed", "paused"):
        raise HTTPException(400, "Only active, paused or closed subscriptions can be renewed")
    base = s.expiry_date or date.today()
    s.expiry_date = bl.add_period(base, s.plan.billing_period, 1)
    if s.status == "closed":
        s.status = "active"
    s.next_invoice_date = bl.next_due(s) if s.status == "active" else s.next_invoice_date
    db.commit()
    return sub_out(load_sub(db, sid, user), detail=True)
