"""PART 6 - Invoice generation: billing run, confirm / cancel / send / print, listing."""
from datetime import date
from html import escape
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from .. import billing as bl
from ..db import get_db
from ..deps import TEAM, current_user, my_customer_id, paginate, ser
from ..mailer import send_email
from ..models import Invoice, User, now

router = APIRouter(prefix="/api", tags=["invoices"])


class RunBillingIn(BaseModel):
    as_of: Optional[date] = None  # lets finance run billing for a given day


def invoice_out(i: Invoice, detail: bool = False) -> dict:
    overdue = i.status == "confirmed" and i.due_date < date.today()
    d = ser(i, customer_name=i.customer.name, subscription_number=i.subscription.number,
            balance=bl.money(i.total - i.amount_paid) if i.status in ("confirmed", "draft") else 0.0,
            overdue=overdue)
    if detail:
        d["lines"] = [ser(l) for l in i.lines]
        d["payments"] = [ser(p) for p in i.payments]
        d["customer"] = ser(i.customer)
    return d


def load_invoice(db: Session, iid: int, user: User) -> Invoice:
    i = (db.query(Invoice).options(joinedload(Invoice.customer), joinedload(Invoice.subscription),
                                   joinedload(Invoice.lines), joinedload(Invoice.payments))
         .filter_by(id=iid).first())
    if not i or (user.role == "customer" and i.customer_id != my_customer_id(user, db)):
        raise HTTPException(404, "Invoice not found")
    return i


@router.get("/invoices")
def list_invoices(status: Optional[str] = None, overdue: bool = False, customer_id: Optional[int] = None,
                  subscription_id: Optional[int] = None, q: Optional[str] = None, page: int = 1,
                  page_size: int = Query(50, le=200), db: Session = Depends(get_db),
                  user: User = Depends(current_user)):
    query = (db.query(Invoice).options(joinedload(Invoice.customer), joinedload(Invoice.subscription))
             .order_by(Invoice.id.desc()))
    if user.role == "customer":
        customer_id = my_customer_id(user, db)
        query = query.filter(Invoice.status != "draft")  # customers only see issued invoices
    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)
    if subscription_id:
        query = query.filter(Invoice.subscription_id == subscription_id)
    if overdue:
        query = query.filter(Invoice.status == "confirmed", Invoice.due_date < date.today())
    elif status:
        query = query.filter(Invoice.status == status)
    if q:
        query = query.filter(Invoice.number.ilike(f"%{q}%"))
    total, items, page, size = paginate(query, page, page_size)
    return {"total": total, "page": page, "page_size": size, "items": [invoice_out(i) for i in items]}


@router.get("/invoices/{iid}")
def get_invoice(iid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return invoice_out(load_invoice(db, iid, user), detail=True)


@router.post("/billing/run")
def run_billing(body: RunBillingIn = RunBillingIn(), db: Session = Depends(get_db), _=Depends(TEAM)):
    """Billing day: creates a draft invoice for every subscription period that has fallen due."""
    return bl.run_billing(db, body.as_of)


@router.post("/invoices/confirm-drafts")
def confirm_all_drafts(db: Session = Depends(get_db), _=Depends(TEAM)):
    n = db.query(Invoice).filter(Invoice.status == "draft").update({"status": "confirmed"})
    db.commit()
    return {"confirmed": n}


@router.post("/invoices/{iid}/confirm")
def confirm(iid: int, db: Session = Depends(get_db), user: User = Depends(TEAM)):
    i = load_invoice(db, iid, user)
    if i.status != "draft":
        raise HTTPException(400, "Only draft invoices can be confirmed")
    i.status = "confirmed"
    db.commit()
    return invoice_out(i, detail=True)


@router.post("/invoices/{iid}/cancel")
def cancel(iid: int, db: Session = Depends(get_db), user: User = Depends(TEAM)):
    i = load_invoice(db, iid, user)
    if i.status not in ("draft", "confirmed"):
        raise HTTPException(400, f"A {i.status} invoice cannot be cancelled")
    if i.payments:
        raise HTTPException(400, "This invoice already has payments recorded")
    i.status = "cancelled"
    db.commit()
    return invoice_out(i, detail=True)


@router.post("/invoices/{iid}/send")
def send(iid: int, db: Session = Depends(get_db), user: User = Depends(TEAM)):
    i = load_invoice(db, iid, user)
    if i.status == "cancelled":
        raise HTTPException(400, "Cancelled invoices cannot be sent")
    if not i.customer.email:
        raise HTTPException(400, "This customer has no email address")
    send_email(i.customer.email, f"Invoice {i.number} from Brightloop Software",
               f"Hello {i.customer.name},\n\nInvoice {i.number} for {i.total:.2f} is due on {i.due_date}.\n"
               f"Period: {i.period_start} to {i.period_end}.\n\nThank you,\nBrightloop Software")
    i.sent_at = now()
    db.commit()
    return invoice_out(i, detail=True)


@router.get("/invoices/{iid}/print", response_class=HTMLResponse)
def print_invoice(iid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    i = load_invoice(db, iid, user)
    rows = "".join(
        f"<tr><td>{escape(l.description)}</td><td class=r>{l.quantity}</td><td class=r>{l.unit_price:.2f}</td>"
        f"<td class=r>{l.discount_amount:.2f}</td><td class=r>{l.tax_rate:g}%</td><td class=r>{l.line_total:.2f}</td></tr>"
        for l in i.lines)
    return f"""<!doctype html><meta charset=utf-8><title>{i.number}</title>
<style>body{{font:14px system-ui;max-width:780px;margin:30px auto;color:#111}}table{{width:100%;border-collapse:collapse}}
th,td{{padding:8px;border-bottom:1px solid #ddd;text-align:left}}.r{{text-align:right}}h1{{margin:0}}</style>
<h1>Invoice {i.number}</h1><p>Brightloop Software<br>Status: <b>{i.status.upper()}</b></p>
<p><b>Bill to:</b> {escape(i.customer.name)} {escape(i.customer.company)}<br>{escape(i.customer.address)}</p>
<p>Issued {i.issue_date} &middot; Due {i.due_date} &middot; Period {i.period_start} to {i.period_end}</p>
<table><tr><th>Item</th><th class=r>Qty</th><th class=r>Price</th><th class=r>Discount</th><th class=r>Tax</th><th class=r>Total</th></tr>{rows}</table>
<p class=r>Subtotal {i.subtotal:.2f}<br>Discount -{i.discount_total:.2f}<br>Tax {i.tax_total:.2f}<br>
<b>Total {i.total:.2f}</b><br>Paid {i.amount_paid:.2f}</p><script>window.print()</script>"""
