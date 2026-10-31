"""PART 3 - Product and plan creation: products, variants, taxes, plans, quotation templates."""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..db import get_db
from ..deps import ADMIN, TEAM, apply_updates, ser
from ..models import Plan, Product, Tax, Template, TemplateLine, Variant

router = APIRouter(prefix="/api", tags=["catalog"])
PERIODS = {"daily", "weekly", "monthly", "yearly"}


# ---------------------------------------------------------------- taxes
class TaxIn(BaseModel):
    name: str
    rate_percent: float


@router.get("/taxes")
def list_taxes(db: Session = Depends(get_db), _=Depends(TEAM)):
    return [ser(t) for t in db.query(Tax).order_by(Tax.id)]


@router.post("/taxes")
def create_tax(body: TaxIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    if not 0 <= body.rate_percent <= 100:
        raise HTTPException(400, "Tax rate must be between 0 and 100")
    t = Tax(**body.model_dump())
    db.add(t)
    db.commit()
    return ser(t)


@router.put("/taxes/{tid}")
def update_tax(tid: int, body: TaxIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    t = db.get(Tax, tid) or _missing("Tax")
    apply_updates(t, body.model_dump())
    db.commit()
    return ser(t)


# ---------------------------------------------------------------- products + variants
class ProductIn(BaseModel):
    name: str
    type: str = "service"
    sales_price: float
    cost_price: float = 0
    notes: str = ""
    tax_id: Optional[int] = None
    active: bool = True


class VariantIn(BaseModel):
    attribute: str          # e.g. Brand
    value: str              # e.g. Odoo
    extra_price: float = 0  # e.g. 560


def _missing(what: str):
    raise HTTPException(404, f"{what} not found")


def product_out(p: Product) -> dict:
    return ser(p, tax_name=p.tax.name if p.tax else None, variants=[ser(v) for v in p.variants])


@router.get("/products")
def list_products(db: Session = Depends(get_db), _=Depends(TEAM)):
    q = db.query(Product).options(joinedload(Product.variants), joinedload(Product.tax)).order_by(Product.id)
    return [product_out(p) for p in q]


@router.post("/products")
def create_product(body: ProductIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    if body.sales_price < 0 or body.cost_price < 0:
        raise HTTPException(400, "Prices cannot be negative")
    p = Product(**body.model_dump())
    db.add(p)
    db.commit()
    return product_out(p)


@router.put("/products/{pid}")
def update_product(pid: int, body: ProductIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    p = db.get(Product, pid) or _missing("Product")
    apply_updates(p, body.model_dump())
    db.commit()
    return product_out(p)


@router.post("/products/{pid}/variants")
def add_variant(pid: int, body: VariantIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    p = db.get(Product, pid) or _missing("Product")
    v = Variant(product_id=p.id, **body.model_dump())
    db.add(v)
    db.commit()
    return ser(v)


@router.delete("/variants/{vid}")
def delete_variant(vid: int, db: Session = Depends(get_db), _=Depends(ADMIN)):
    v = db.get(Variant, vid) or _missing("Variant")
    db.delete(v)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- plans
class PlanIn(BaseModel):
    name: str
    price: float = 0
    billing_period: str = "monthly"
    min_quantity: int = 1
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    auto_close: bool = False
    allow_early_close: bool = True
    allow_pause: bool = True
    allow_renew: bool = True


class PlanStatusIn(BaseModel):
    status: str  # open | paused | closed


def _check_plan(b: PlanIn):
    if b.billing_period not in PERIODS:
        raise HTTPException(400, "Billing period must be daily, weekly, monthly or yearly")
    if b.min_quantity < 1:
        raise HTTPException(400, "Minimum quantity must be at least 1")
    if b.start_date and b.end_date and b.end_date < b.start_date:
        raise HTTPException(400, "Plan end date is before its start date")


@router.get("/plans")
def list_plans(db: Session = Depends(get_db), _=Depends(TEAM)):
    return [ser(p) for p in db.query(Plan).order_by(Plan.id)]


@router.post("/plans")
def create_plan(body: PlanIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    _check_plan(body)
    p = Plan(**body.model_dump())
    db.add(p)
    db.commit()
    return ser(p)


@router.put("/plans/{pid}")
def update_plan(pid: int, body: PlanIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    _check_plan(body)
    p = db.get(Plan, pid) or _missing("Plan")
    apply_updates(p, body.model_dump())
    db.commit()
    return ser(p)


@router.post("/plans/{pid}/status")
def set_plan_status(pid: int, body: PlanStatusIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    """Close early, pause, or reopen a plan - only if the plan's own switches allow it."""
    p = db.get(Plan, pid) or _missing("Plan")
    if body.status not in {"open", "paused", "closed"}:
        raise HTTPException(400, "Status must be open, paused or closed")
    if body.status == "closed" and not p.allow_early_close:
        raise HTTPException(400, "This plan cannot be closed early")
    if body.status == "paused" and not p.allow_pause:
        raise HTTPException(400, "This plan cannot be paused")
    if body.status == "open" and not p.allow_renew:
        raise HTTPException(400, "This plan cannot be renewed or reopened")
    p.status = body.status
    db.commit()
    return ser(p)


# ---------------------------------------------------------------- quotation templates
class TemplateLineIn(BaseModel):
    product_id: int
    variant_id: Optional[int] = None
    quantity: int = 1


class TemplateIn(BaseModel):
    name: str
    plan_id: int
    validity_days: int = 30
    lines: List[TemplateLineIn] = []


def template_out(t: Template) -> dict:
    return ser(t, lines=[ser(l) for l in t.lines])


@router.get("/templates")
def list_templates(db: Session = Depends(get_db), _=Depends(TEAM)):
    return [template_out(t) for t in db.query(Template).options(joinedload(Template.lines)).order_by(Template.id)]


@router.post("/templates")
def create_template(body: TemplateIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    if not db.get(Plan, body.plan_id):
        raise HTTPException(400, "Plan not found")
    t = Template(name=body.name, plan_id=body.plan_id, validity_days=body.validity_days,
                 lines=[TemplateLine(**l.model_dump()) for l in body.lines])
    db.add(t)
    db.commit()
    return template_out(t)


@router.delete("/templates/{tid}")
def delete_template(tid: int, db: Session = Depends(get_db), _=Depends(ADMIN)):
    t = db.get(Template, tid) or _missing("Template")
    db.delete(t)
    db.commit()
    return {"ok": True}
