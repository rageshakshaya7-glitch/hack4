"""Shared helpers: authentication, role checks, serialisation, pagination."""
from datetime import date, datetime

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import security as sec
from .db import get_db
from .models import Customer, User

bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        data = sec.decode_token(creds.credentials)
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    user = db.get(User, int(data["sub"]))
    if not user:
        raise HTTPException(401, "Unknown user")
    return user


def require(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "You do not have access to this action")
        return user
    return dep


ADMIN = require("admin")
TEAM = require("admin", "staff")


def my_customer_id(user: User, db: Session) -> int:
    c = db.query(Customer).filter_by(user_id=user.id).first()
    if not c:
        raise HTTPException(403, "No customer profile linked to this login")
    return c.id


def iso(v):
    return v.isoformat() if isinstance(v, (date, datetime)) else v


def ser(obj, **extra) -> dict:
    d = {c.name: iso(getattr(obj, c.name)) for c in obj.__table__.columns}
    d.update(extra)
    return d


def paginate(query, page: int, page_size: int):
    page = max(page, 1)
    page_size = min(max(page_size, 1), 200)
    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()
    return total, items, page, page_size


def apply_updates(obj, data: dict):
    for k, v in data.items():
        setattr(obj, k, v)
