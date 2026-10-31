import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import security as sec
from .db import Base, SessionLocal, engine
from .models import User
from .routers import auth, catalog, customers, invoices, payments, reports, subscriptions

STATIC = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:  # first admin, so the system can always be logged into
        if not db.query(User).filter_by(role="admin").first():
            email = os.getenv("ADMIN_EMAIL", "admin@brightloop.test")
            password = os.getenv("ADMIN_PASSWORD", "Admin@12345")
            db.add(User(email=email, name="Admin", password_hash=sec.hash_password(password), role="admin"))
            db.commit()
            print(f"[setup] created admin {email} - change this password for real use")
    yield


app = FastAPI(title="Brightloop Subscription Management", lifespan=lifespan)
for r in (auth, catalog, customers, subscriptions, invoices, payments, reports):
    app.include_router(r.router)

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC / "index.html")
