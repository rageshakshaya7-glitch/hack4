"""PART 7 - Payment and discount management."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from .. import billing as bl
from ..db import get_db
from ..deps import ADMIN, TEAM, apply_updates, paginate, ser
from ..models import Discount, Invoice, Payment, Product, Subscription, User
from .invoices import invoice_out, load_invoice

router = APIRouter(prefix="/api", tags=["payments"])
METHODS = {"cash", "bank_transfer", "card", "upi", "cheque", "other"}


# ---------------------------------------------------------------- payments
class PaymentIn(BaseModel):
    method: str
    amount: float
    date: Optional[date] = None
    note: str = ""


@router.post("/invoices/{iid}/payments")
def record_payment(iid: int, body: PaymentIn, db: Session = Depends(get_db), user: User = Depends(TEAM)):
    i = load_invoice(db, iid, user)
    if i.status != "confirmed":
        raise HTTPException(400, "Payments can only be recorded against confirmed invoices")
    if body.method not in METHODS:
        raise HTTPException(400, f"Method must be one of: {', '.join(sorted(METHODS))}")
    balance = bl.money(i.total - i.amount_paid)
    if body.amount <= 0:
        raise HTTPException(400, "Amount must be greater than zero")
    if body.amount > balance + 0.005:
        raise HTTPException(400, f"Amount is more than the outstanding balance ({balance:.2f})")
    db.add(Payment(invoice_id=i.id, method=body.method, amount=bl.money(body.amount),
                   date=body.date or date.today(), note=body.note, created_by=user.id))
    i.amount_paid = bl.money(i.amount_paid + body.amount)
    if i.amount_paid >= i.total - 0.005:
        i.status = "paid"
    db.commit()
    return invoice_out(load_invoice(db, iid, user), detail=True)


@router.get("/payments")
def list_payments(method: Optional[str] = None, date_from: Optional[date] = None, date_to: Optional[date] = None,
                  page: int = 1, page_size: int = Query(50, le=200), db: Session = Depends(get_db),
                  _=Depends(TEAM)):
    q = db.query(Payment).order_by(Payment.date.desc(), Payment.id.desc())
    if method:
        q = q.filter(Payment.method == method)
    if date_from:
        q = q.filter(Payment.date >= date_from)
    if date_to:
        q = q.filter(Payment.date <= date_to)
    total, items, page, size = paginate(q, page, page_size)
    inv = {i.id: i for i in db.query(Invoice).options(joinedload(Invoice.customer))
           .filter(Invoice.id.in_([p.invoice_id for p in items]))} if items else {}
    return {"total": total, "page": page, "page_size": size,
            "items": [ser(p, invoice_number=inv[p.invoice_id].number, customer_name=inv[p.invoice_id].customer.name)
                      for p in items]}


# ---------------------------------------------------------------- discounts
class DiscountIn(BaseModel):
    name: str
    kind: str                                 # fixed | percent
    value: float
    applies_to: str = "subscription"          # product | subscription
    product_id: Optional[int] = None
    subscription_id: Optional[int] = None     # optionally target one subscription
    min_purchase: float = 0
    min_quantity: int = 0
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    usage_limit: Optional[int] = None
    active: bool = True


def _check_discount(db: Session, b: DiscountIn):
    if b.kind not in ("fixed", "percent"):
        raise HTTPException(400, "Kind must be fixed or percent")
    if b.value <= 0 or (b.kind == "percent" and b.value > 100):
        raise HTTPException(400, "Discount value must be above 0 (and at most 100 for percentages)")
    if b.applies_to not in ("product", "subscription"):
        raise HTTPException(400, "Applies-to must be product or subscription")
    if b.applies_to == "product" and not (b.product_id and db.get(Product, b.product_id)):
        raise HTTPException(400, "Choose the product this discount applies to")
    if b.subscription_id and not db.get(Subscription, b.subscription_id):
        raise HTTPException(400, "Subscription not found")
    if b.start_date and b.end_date and b.end_date < b.start_date:
        raise HTTPException(400, "End date is before the start date")
    if b.usage_limit is not None and b.usage_limit < 1:
        raise HTTPException(400, "Usage limit must be at least 1")


def discount_out(d: Discount) -> dict:
    today = date.today()
    exhausted = d.usage_limit is not None and d.times_used >= d.usage_limit
    expired = bool(d.end_date and d.end_date < today)
    return ser(d, remaining_uses=None if d.usage_limit is None else max(d.usage_limit - d.times_used, 0),
               state="inactive" if not d.active else "exhausted" if exhausted else "expired" if expired
               else "scheduled" if d.start_date and d.start_date > today else "live")


@router.get("/discounts")
def list_discounts(db: Session = Depends(get_db), _=Depends(TEAM)):
    return [discount_out(d) for d in db.query(Discount).order_by(Discount.id.desc())]


@router.post("/discounts")
def create_discount(body: DiscountIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    _check_discount(db, body)
    d = Discount(**body.model_dump())
    db.add(d)
    db.commit()
    return discount_out(d)


@router.put("/discounts/{did}")
def update_discount(did: int, body: DiscountIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    _check_discount(db, body)
    d = db.get(Discount, did)
    if not d:
        raise HTTPException(404, "Discount not found")
    apply_updates(d, body.model_dump())
    db.commit()
    return discount_out(d)


@router.delete("/discounts/{did}")
def delete_discount(did: int, db: Session = Depends(get_db), _=Depends(ADMIN)):
    d = db.get(Discount, did)
    if not d:
        raise HTTPException(404, "Discount not found")
    d.active = False  # keep history; invoices already reference its name
    db.commit()
    return discount_out(d)
