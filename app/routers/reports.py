"""PART 2 (admin dashboard) and PART 8 (reports): one place for active subscriptions, revenue,
payments and overdue invoices, with filters. Everything is aggregated in SQL."""
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import billing as bl
from ..db import get_db
from ..deps import TEAM
from ..models import Invoice, Payment, Plan, Subscription, SubscriptionLine

router = APIRouter(prefix="/api/reports", tags=["reports"])
PER_MONTH = {"daily": 365 / 12, "weekly": 52 / 12, "monthly": 1, "yearly": 1 / 12}


def _range(date_from, date_to):
    date_to = date_to or date.today()
    date_from = date_from or (date_to - timedelta(days=365))
    return date_from, date_to


@router.get("/summary")
def summary(date_from: Optional[date] = None, date_to: Optional[date] = None, customer_id: Optional[int] = None,
            plan_id: Optional[int] = None, db: Session = Depends(get_db), _=Depends(TEAM)):
    date_from, date_to = _range(date_from, date_to)
    today = date.today()

    # --- subscriptions by status
    sq = db.query(Subscription.status, func.count(Subscription.id))
    if customer_id:
        sq = sq.filter(Subscription.customer_id == customer_id)
    if plan_id:
        sq = sq.filter(Subscription.plan_id == plan_id)
    by_status = {s: n for s, n in sq.group_by(Subscription.status)}

    # --- monthly recurring revenue of active subscriptions (lines + plan fee, normalised to a month)
    line_sums = (db.query(Subscription.id, Plan.billing_period, Plan.price, func.coalesce(func.sum(SubscriptionLine.amount), 0))
                 .join(Plan, Plan.id == Subscription.plan_id)
                 .outerjoin(SubscriptionLine, SubscriptionLine.subscription_id == Subscription.id)
                 .filter(Subscription.status == "active"))
    if customer_id:
        line_sums = line_sums.filter(Subscription.customer_id == customer_id)
    if plan_id:
        line_sums = line_sums.filter(Subscription.plan_id == plan_id)
    mrr = sum((lines + price) * PER_MONTH[period]
              for _id, period, price, lines in line_sums.group_by(Subscription.id, Plan.billing_period, Plan.price))

    # --- invoices in range
    iq = db.query(Invoice).filter(Invoice.issue_date >= date_from, Invoice.issue_date <= date_to)
    if customer_id:
        iq = iq.filter(Invoice.customer_id == customer_id)
    if plan_id:
        iq = iq.join(Subscription, Subscription.id == Invoice.subscription_id).filter(Subscription.plan_id == plan_id)
    invoiced = iq.filter(Invoice.status.in_(["confirmed", "paid"])).with_entities(func.coalesce(func.sum(Invoice.total), 0)).scalar()
    inv_counts = dict(iq.with_entities(Invoice.status, func.count(Invoice.id)).group_by(Invoice.status).all())

    # --- revenue collected (payments in range)
    pq = (db.query(Payment.date, Payment.amount).join(Invoice, Invoice.id == Payment.invoice_id)
          .filter(Payment.date >= date_from, Payment.date <= date_to))
    if customer_id:
        pq = pq.filter(Invoice.customer_id == customer_id)
    if plan_id:
        pq = pq.join(Subscription, Subscription.id == Invoice.subscription_id).filter(Subscription.plan_id == plan_id)
    monthly = defaultdict(float)
    collected = 0.0
    for d, amt in pq:
        monthly[d.strftime("%Y-%m")] += amt
        collected += amt

    # --- outstanding and overdue (all time, as of today)
    oq = db.query(func.count(Invoice.id), func.coalesce(func.sum(Invoice.total - Invoice.amount_paid), 0)).filter(Invoice.status == "confirmed")
    if customer_id:
        oq = oq.filter(Invoice.customer_id == customer_id)
    if plan_id:
        oq = oq.join(Subscription, Subscription.id == Invoice.subscription_id).filter(Subscription.plan_id == plan_id)
    out_n, out_amt = oq.one()
    ov_n, ov_amt = oq.filter(Invoice.due_date < today).one()

    return {
        "range": {"from": date_from.isoformat(), "to": date_to.isoformat()},
        "active_subscriptions": by_status.get("active", 0),
        "subscriptions_by_status": by_status,
        "mrr": bl.money(mrr),
        "invoiced": bl.money(invoiced),
        "revenue_collected": bl.money(collected),
        "outstanding": {"count": out_n, "amount": bl.money(out_amt)},
        "overdue": {"count": ov_n, "amount": bl.money(ov_amt)},
        "invoices_by_status": inv_counts,
        "revenue_by_month": [{"month": m, "amount": bl.money(a)} for m, a in sorted(monthly.items())],
    }


@router.get("/overdue")
def overdue_report(limit: int = 100, db: Session = Depends(get_db), _=Depends(TEAM)):
    """Overdue invoices, oldest first, with days late - the chase list."""
    today = date.today()
    rows = (db.query(Invoice).filter(Invoice.status == "confirmed", Invoice.due_date < today)
            .order_by(Invoice.due_date).limit(min(limit, 500)).all())
    return [{"id": i.id, "number": i.number, "customer": i.customer.name, "due_date": i.due_date.isoformat(),
             "days_overdue": (today - i.due_date).days, "balance": bl.money(i.total - i.amount_paid)} for i in rows]
