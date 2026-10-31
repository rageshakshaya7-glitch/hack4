"""PART 1 - Login and registration: sign-up, login, password reset, staff accounts."""
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import security as sec
from ..deps import ADMIN, current_user, ser
from ..db import get_db
from ..mailer import send_email
from ..models import Customer, PasswordReset, User, now

router = APIRouter(prefix="/api", tags=["auth"])


class SignupIn(BaseModel):
    email: str
    password: str
    name: str = ""
    company: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class ForgotIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    token: str
    new_password: str


class StaffIn(BaseModel):
    email: str
    name: str = ""
    password: str


def _check_credentials(db: Session, email: str, password: str) -> str:
    email = email.strip().lower()
    if not sec.EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address")
    errs = sec.password_errors(password)
    if errs:
        raise HTTPException(400, "Password " + ", ".join(errs))
    if db.query(User).filter_by(email=email).first():
        raise HTTPException(409, "An account with this email already exists")  # one account per email
    return email


def user_out(u: User) -> dict:
    d = ser(u)
    d.pop("password_hash", None)
    return d


@router.post("/auth/signup")
def signup(body: SignupIn, db: Session = Depends(get_db)):
    """Public self-registration. Always creates a *customer* - never staff or admin."""
    email = _check_credentials(db, body.email, body.password)
    user = User(email=email, name=body.name or email, password_hash=sec.hash_password(body.password),
                role="customer")
    db.add(user)
    db.flush()
    db.add(Customer(user_id=user.id, name=body.name or email, email=email, company=body.company))
    db.commit()
    return {"token": sec.make_token(user.id, user.role), "user": user_out(user)}


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=body.email.strip().lower()).first()
    if not user or not sec.verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return {"token": sec.make_token(user.id, user.role), "user": user_out(user)}


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    cust = db.query(Customer).filter_by(user_id=user.id).first()
    return {**user_out(user), "customer_id": cust.id if cust else None}


@router.post("/auth/forgot")
def forgot_password(body: ForgotIn, db: Session = Depends(get_db)):
    """Always answers the same way so the endpoint can't be used to discover registered emails."""
    user = db.query(User).filter_by(email=body.email.strip().lower()).first()
    if user:
        token = secrets.token_urlsafe(32)
        db.add(PasswordReset(user_id=user.id, token=token, expires_at=now() + timedelta(hours=1)))
        db.commit()
        base = os.getenv("BASE_URL", "http://localhost:8000")
        send_email(user.email, "Reset your Brightloop password",
                   f"Hello {user.name},\n\nUse this link within 1 hour to choose a new password:\n"
                   f"{base}/#/reset?token={token}\n\nIf you did not ask for this, ignore this email.")
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/auth/reset")
def reset_password(body: ResetIn, db: Session = Depends(get_db)):
    pr = db.query(PasswordReset).filter_by(token=body.token, used=False).first()
    if not pr or pr.expires_at < now():
        raise HTTPException(400, "This reset link is invalid or has expired")
    errs = sec.password_errors(body.new_password)
    if errs:
        raise HTTPException(400, "Password " + ", ".join(errs))
    db.get(User, pr.user_id).password_hash = sec.hash_password(body.new_password)
    pr.used = True
    db.commit()
    return {"message": "Password updated. You can log in now."}


# ---------------------------------------------------------------- staff (admin only)
@router.post("/users/staff")
def add_staff(body: StaffIn, db: Session = Depends(get_db), _=Depends(ADMIN)):
    email = _check_credentials(db, body.email, body.password)
    user = User(email=email, name=body.name or email, password_hash=sec.hash_password(body.password), role="staff")
    db.add(user)
    db.commit()
    return user_out(user)


@router.get("/users")
def list_users(role: Optional[str] = None, db: Session = Depends(get_db), _=Depends(ADMIN)):
    q = db.query(User).order_by(User.id)
    if role:
        q = q.filter_by(role=role)
    return [user_out(u) for u in q.limit(500)]
