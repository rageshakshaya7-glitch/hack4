import os
import tempfile
from datetime import date, timedelta

import pytest

_dir = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_dir}/test.db"
os.environ["OUTBOX_DIR"] = f"{_dir}/outbox"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

GOOD = "Str0ng!Pass1"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def hdr(token):
    return {"Authorization": f"Bearer {token}"}


def login(c, email, pw):
    r = c.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# ------------------------------------------------------------ part 1: login & registration
def test_password_rules_and_unique_email(client):
    for bad in ["Short1!", "alllowercase1!", "ALLUPPERCASE1!", "NoSpecialChar1", "Eight8c!"]:
        r = client.post("/api/auth/signup", json={"email": "a@x.com", "password": bad})
        assert r.status_code == 400, bad
    assert client.post("/api/auth/signup", json={"email": "a@x.com", "password": GOOD}).status_code == 200
    assert client.post("/api/auth/signup", json={"email": "A@X.com", "password": GOOD}).status_code == 409


def test_reset_link_flow(client):
    client.post("/api/auth/signup", json={"email": "r@x.com", "password": GOOD})
    client.post("/api/auth/forgot", json={"email": "r@x.com"})
    files = sorted(os.listdir(os.environ["OUTBOX_DIR"]))
    body = open(os.path.join(os.environ["OUTBOX_DIR"], files[-1])).read()
    token = body.split("token=")[1].split()[0]
    assert client.post("/api/auth/reset", json={"token": token, "new_password": "N3w!Passw0rd"}).status_code == 200
    assert client.post("/api/auth/reset", json={"token": token, "new_password": "N3w!Passw0rd"}).status_code == 400
    login(client, "r@x.com", "N3w!Passw0rd")


def test_roles(client):
    admin = login(client, "admin@brightloop.test", "Admin@12345")
    cust = login(client, "a@x.com", GOOD)
    assert client.post("/api/users/staff", headers=hdr(cust), json={"email": "s@x.com", "password": GOOD}).status_code == 403
    assert client.post("/api/users/staff", headers=hdr(admin), json={"email": "s@x.com", "password": GOOD}).status_code == 200
    staff = login(client, "s@x.com", GOOD)
    assert client.post("/api/users/staff", headers=hdr(staff), json={"email": "t@x.com", "password": GOOD}).status_code == 403
    assert client.post("/api/taxes", headers=hdr(staff), json={"name": "X", "rate_percent": 5}).status_code == 403
    assert client.get("/api/customers", headers=hdr(cust)).status_code == 403


# ------------------------------------------------------------ parts 3-8: the billing month
def test_full_billing_flow(client):
    admin = hdr(login(client, "admin@brightloop.test", "Admin@12345"))
    staff = hdr(login(client, "s@x.com", GOOD))

    tax = client.post("/api/taxes", headers=admin, json={"name": "GST", "rate_percent": 10}).json()
    prod = client.post("/api/products", headers=admin, json={"name": "CRM", "sales_price": 1000, "cost_price": 300,
                                                            "tax_id": tax["id"]}).json()
    var = client.post(f"/api/products/{prod['id']}/variants", headers=admin,
                      json={"attribute": "Brand", "value": "Odoo", "extra_price": 560}).json()
    plan = client.post("/api/plans", headers=admin, json={"name": "Monthly", "billing_period": "monthly"}).json()
    tpl = client.post("/api/templates", headers=admin, json={"name": "Starter", "plan_id": plan["id"], "validity_days": 10,
                                                            "lines": [{"product_id": prod["id"], "variant_id": var["id"], "quantity": 2}]}).json()
    cust = client.post("/api/customers", headers=staff, json={"name": "Big Co", "email": "big@co.com"}).json()

    start = date.today() - timedelta(days=65)  # three monthly periods are already due
    sub = client.post("/api/subscriptions", headers=staff, json={
        "customer_id": cust["id"], "template_id": tpl["id"], "start_date": start.isoformat(),
        "expiry_date": (start + timedelta(days=365)).isoformat()}).json()
    assert sub["number"].startswith("SUB-") and sub["status"] == "draft"
    assert sub["lines"][0]["unit_price"] == 1560  # variant adds 560
    assert sub["quotation_valid_until"] == (date.today() + timedelta(days=10)).isoformat()

    for step in ["quotation", "confirmed", "active"]:
        assert client.post(f"/api/subscriptions/{sub['id']}/transition", headers=staff, json={"to": step}).status_code == 200
    assert client.post(f"/api/subscriptions/{sub['id']}/transition", headers=staff, json={"to": "draft"}).status_code == 400

    # discount: only the admin can make one; 10% on the subscription, usable once
    body = {"name": "Seat discount", "kind": "percent", "value": 10, "min_quantity": 2, "usage_limit": 1}
    assert client.post("/api/discounts", headers=staff, json=body).status_code == 403
    assert client.post("/api/discounts", headers=admin, json=body).status_code == 200

    early = (date.today() - timedelta(days=40)).isoformat()
    assert client.post("/api/billing/run", headers=staff, json={"as_of": early}).json()["invoices_created"] == 1
    run1 = client.post("/api/billing/run", headers=staff, json={}).json()
    assert run1["invoices_created"] == 2                       # catch-up: nothing skipped (3 periods in total)
    run2 = client.post("/api/billing/run", headers=staff, json={}).json()
    assert run2["invoices_created"] == 0                       # nothing billed twice

    invs = client.get(f"/api/invoices?subscription_id={sub['id']}", headers=staff).json()["items"]
    assert len(invs) == 3
    invs.sort(key=lambda i: i["id"])
    first, second = invs[0], invs[1]
    # 2 x 1560 = 3120, 10% discount = 312, tax 10% on 2808 = 280.80 -> 3088.80
    assert first["subtotal"] == 3120 and first["discount_total"] == 312
    assert first["tax_total"] == 280.8 and first["total"] == 3088.8
    assert second["discount_total"] == 0                       # usage limit reached -> stops on its own
    assert second["total"] == 3432                             # 3120 + 10% tax

    assert client.post("/api/invoices/confirm-drafts", headers=staff).json()["confirmed"] == 3
    r = client.post(f"/api/invoices/{second['id']}/payments", headers=staff,
                    json={"method": "card", "amount": 1000, "note": "part"})
    assert r.json()["status"] == "confirmed"
    assert client.post(f"/api/invoices/{second['id']}/payments", headers=staff,
                       json={"method": "card", "amount": 99999}).status_code == 400
    r = client.post(f"/api/invoices/{second['id']}/payments", headers=staff,
                    json={"method": "bank_transfer", "amount": 2432})
    assert r.json()["status"] == "paid"

    s = client.get("/api/reports/summary", headers=staff).json()
    assert s["active_subscriptions"] == 1
    assert s["revenue_collected"] == 3432
    assert s["overdue"]["count"] == 1                          # first invoice: issued 40 days ago, 15-day terms
    assert client.get("/api/reports/overdue", headers=staff).json()


def test_customer_sees_only_own(client):
    cust = hdr(login(client, "a@x.com", GOOD))
    assert client.get("/api/subscriptions", headers=cust).json()["total"] == 0
    assert client.get("/api/invoices", headers=cust).json()["total"] == 0
    assert client.get("/api/subscriptions/1", headers=cust).status_code == 404
