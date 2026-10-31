"""PART 4 - Customer management (admin and staff)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import TEAM, apply_updates, paginate, ser
from ..models import Customer, Invoice, Subscription

router = APIRouter(prefix="/api", tags=["customers"])


class CustomerIn(BaseModel):
    name: str
    email: str = ""
    company: str = ""
    phone: str = ""
    address: str = ""


@router.get("/customers")
def list_customers(q: Optional[str] = None, page: int = 1, page_size: int = Query(50, le=500),
                   db: Session = Depends(get_db), _=Depends(TEAM)):
    query = db.query(Customer).order_by(Customer.name)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Customer.name.ilike(like), Customer.email.ilike(like), Customer.company.ilike(like)))
    total, items, page, size = paginate(query, page, min(page_size, 500))
    return {"total": total, "page": page, "page_size": size, "items": [ser(c) for c in items]}


@router.post("/customers")
def create_customer(body: CustomerIn, db: Session = Depends(get_db), _=Depends(TEAM)):
    c = Customer(**body.model_dump())
    db.add(c)
    db.commit()
    return ser(c)


@router.put("/customers/{cid}")
def update_customer(cid: int, body: CustomerIn, db: Session = Depends(get_db), _=Depends(TEAM)):
    c = db.get(Customer, cid)
    if not c:
        raise HTTPException(404, "Customer not found")
    apply_updates(c, body.model_dump())
    db.commit()
    return ser(c)


@router.get("/customers/{cid}")
def customer_detail(cid: int, db: Session = Depends(get_db), _=Depends(TEAM)):
    c = db.get(Customer, cid)
    if not c:
        raise HTTPException(404, "Customer not found")
    subs = db.query(Subscription).filter_by(customer_id=cid).order_by(Subscription.id.desc()).limit(100).all()
    invs = db.query(Invoice).filter_by(customer_id=cid).order_by(Invoice.id.desc()).limit(100).all()
    return ser(c, subscriptions=[ser(s) for s in subs], invoices=[ser(i) for i in invs])
