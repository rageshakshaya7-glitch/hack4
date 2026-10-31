"""Demo data.   python -m app.seed            (small demo)
               python -m app.seed --bulk 3000  (adds thousands of subscriptions for performance checks)"""
import argparse
import random
from datetime import date, timedelta

from . import billing as bl
from . import security as sec
from .db import Base, SessionLocal, engine
from .models import (Customer, Discount, Payment, Plan, Product, Subscription, SubscriptionLine, Tax, Template,
                     TemplateLine, User, Variant)

PASSWORD = "Demo@12345"


def seed(bulk: int = 0):
    Base.metadata.create_all(engine)
    db = SessionLocal()
    if db.query(Product).count():
        print("Database already has data - skipping base seed")
    else:
        admin = db.query(User).filter_by(role="admin").first()
        if not admin:
            db.add(User(email="admin@brightloop.test", name="Admin", password_hash=sec.hash_password("Admin@12345"), role="admin"))
        db.add(User(email="staff@brightloop.test", name="Sam Staff", password_hash=sec.hash_password(PASSWORD), role="staff"))
        cu = User(email="customer@brightloop.test", name="Casey Customer", password_hash=sec.hash_password(PASSWORD), role="customer")
        db.add(cu)
        db.flush()
        db.add(Customer(user_id=cu.id, name="Casey Customer", email=cu.email, company="Casey's Corner Shop"))

        gst = Tax(name="GST 18%", rate_percent=18)
        db.add(gst)
        db.flush()
        crm = Product(name="Brightloop CRM", type="service", sales_price=1200, cost_price=400, tax_id=gst.id, notes="Per seat")
        erp = Product(name="Brightloop ERP", type="service", sales_price=3000, cost_price=1100, tax_id=gst.id)
        addon = Product(name="Extra storage add-on", type="addon", sales_price=300, cost_price=80, tax_id=gst.id)
        db.add_all([crm, erp, addon])
        db.flush()
        db.add_all([Variant(product_id=crm.id, attribute="Brand", value="Odoo", extra_price=560),
                    Variant(product_id=crm.id, attribute="Brand", value="Zoho", extra_price=300),
                    Variant(product_id=erp.id, attribute="Brand", value="Odoo", extra_price=560)])
        monthly = Plan(name="Monthly", price=0, billing_period="monthly", min_quantity=1)
        yearly = Plan(name="Yearly", price=500, billing_period="yearly", min_quantity=5, auto_close=True)
        db.add_all([monthly, yearly])
        db.flush()
        t = Template(name="Small business starter", plan_id=monthly.id, validity_days=30)
        t.lines = [TemplateLine(product_id=crm.id, quantity=2), TemplateLine(product_id=addon.id, quantity=1)]
        db.add(t)
        db.add(Discount(name="Volume 10% (5+ seats)", kind="percent", value=10, applies_to="subscription",
                        min_quantity=5, usage_limit=12))
        db.commit()

    if bulk or not db.query(Customer).filter(Customer.company == "Seed").count():
        _generate(db, bulk or 40)
    db.close()
    print("Seeded. Logins: admin@brightloop.test / Admin@12345 ; staff@brightloop.test and customer@brightloop.test / " + PASSWORD)


def _generate(db, n_subs: int):
    rnd = random.Random(7)
    products = db.query(Product).all()
    plans = db.query(Plan).all()
    n_cust = max(10, n_subs // 3)
    customers = [Customer(name=f"Customer {i}", email=f"cust{i}@example.com", company="Seed") for i in range(n_cust)]
    db.add_all(customers)
    db.flush()
    today = date.today()
    for i in range(n_subs):
        plan = rnd.choice(plans)
        prod = rnd.choice(products)
        qty = max(plan.min_quantity, rnd.randint(1, 8))
        start = today - timedelta(days=rnd.randint(0, 400))
        s = Subscription(number="TMP", customer_id=rnd.choice(customers).id, plan_id=plan.id,
                         status="active" if rnd.random() < 0.85 else "closed", start_date=start,
                         expiry_date=bl.add_period(start, plan.billing_period, 24 if plan.billing_period == "monthly" else 3),
                         payment_terms_days=rnd.choice([7, 15, 30]))
        s.lines = [SubscriptionLine(product_id=prod.id, quantity=qty, unit_price=prod.sales_price,
                                    tax_id=prod.tax_id, amount=bl.money(prod.sales_price * qty))]
        db.add(s)
        db.flush()
        s.number = f"SUB-{s.id:06d}"
        if s.status == "active":
            s.next_invoice_date = bl.next_due(s)
    db.commit()
    result = bl.run_billing(db, today)
    print("Billing:", result)
    from .models import Invoice
    for inv in db.query(Invoice).order_by(Invoice.id).all():
        r = rnd.random()
        if r < 0.9:
            inv.status = "confirmed"
        if r < 0.65:
            inv.status = "paid"
            inv.amount_paid = inv.total
            db.add(Payment(invoice_id=inv.id, method=rnd.choice(["bank_transfer", "card", "upi", "cash"]),
                           amount=inv.total, date=min(today, inv.issue_date + timedelta(days=rnd.randint(0, 20))), note="seed"))
    db.commit()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bulk", type=int, default=0, help="number of extra subscriptions to generate")
    seed(ap.parse_args().bulk)
