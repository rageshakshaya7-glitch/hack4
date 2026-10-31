# Brightloop Subscription Management System

One platform for the whole subscription life-cycle: products and plans, quotations, subscriptions,
automatic recurring invoices, discounts, payments and finance reporting. Built with
**FastAPI + SQLAlchemy + SQLite** and a dependency-free web UI served by the same app.

## Run it (works the same in Antigravity, VS Code or a plain terminal)

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m app.seed                 # demo data (optional)
uvicorn app.main:app --reload
```

Open <http://localhost:8000>.

| Role     | Email                      | Password      |
|----------|----------------------------|---------------|
| Admin    | admin@brightloop.test      | Admin@12345   |
| Staff    | staff@brightloop.test      | Demo@12345    |
| Customer | customer@brightloop.test   | Demo@12345    |

API docs (interactive): <http://localhost:8000/docs>

In **Antigravity**: open this folder, open its terminal, run the commands above, then open
`http://localhost:8000` in the built-in browser.

Performance check: `python -m app.seed --bulk 4000` adds 4,000 subscriptions and ~14,000 invoices;
every page and report still answers in well under a second.

## Push to GitHub

```bash
# create an empty repository on github.com first (no README), then:
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

## Where each part of the brief lives

| Part                           | Backend                            | UI                         |
|--------------------------------|------------------------------------|----------------------------|
| 1. Login and registration      | `app/routers/auth.py`, `app/security.py` | `static/js/auth.js`  |
| 2. Admin dashboard             | `app/routers/reports.py` (`/summary`) | `static/js/dashboard.js` |
| 3. Product and plan creation   | `app/routers/catalog.py`           | `static/js/catalog.js`     |
| 4. Customer management         | `app/routers/customers.py`         | `static/js/customers.js`   |
| 5. Subscription creation       | `app/routers/subscriptions.py`     | `static/js/subscriptions.js` |
| 6. Invoice generation          | `app/billing.py`, `app/routers/invoices.py` | `static/js/invoices.js` |
| 7. Payment and discounts       | `app/routers/payments.py`          | `static/js/payments.js`    |
| 8. Reports                     | `app/routers/reports.py`           | `static/js/reports.js`     |

## Behaviour worth knowing

* **Sign-up rules**: one account per email (case-insensitive); password more than 8 characters with an
  uppercase letter, a lowercase letter and a special character. Self-sign-up always creates a *customer*;
  only the admin can add staff. Reset links are emailed (SMTP via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASSWORD`, `MAIL_FROM`); without SMTP they are printed to the console and saved in `outbox/`.
* **Roles**: admin controls everything; staff run customers, subscriptions, invoices and payments but cannot
  create products, plans, taxes, discounts or staff; customers see only their own subscriptions and issued
  invoices and may pause/resume/close their own subscription if the plan allows it.
* **Nothing billed twice or skipped**: the database enforces one invoice per subscription period, and each
  billing run catches up every period that has fallen due. Periods are computed from the start date, so a
  subscription starting on the 31st does not drift.
* **Discounts** are chosen automatically at invoice time (date window, minimum purchase/quantity, usage
  limit, product or whole subscription, optionally one subscription). They stop when expired or used up.
* **Pausing** bills anything already due first; periods that pass while paused are not billed.
* **Plan rules** (auto-close, early close, pause, renew) are enforced per plan.
* **Money** is stored as rounded floats, which is fine for a demo; switch to integer minor units or
  `Decimal` before handling real money.
* Billing is triggered with **Run billing now** (or `POST /api/billing/run`). To run it daily, schedule a
  call to that endpoint with a staff token, e.g. from cron.

## Configuration (environment variables)

`SECRET_KEY` (set this in production), `DATABASE_URL` (default `sqlite:///./brightloop.db`),
`ADMIN_EMAIL` / `ADMIN_PASSWORD` (first admin when the database is empty), `BASE_URL` (used in reset links).

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```
