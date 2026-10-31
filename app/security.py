import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

import jwt

SECRET = os.getenv("SECRET_KEY", "dev-secret-change-me-in-production-0123456789")
TOKEN_HOURS = 12
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    salt, digest = stored.split("$")
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    return hmac.compare_digest(check, digest)


def password_errors(p: str) -> list[str]:
    """More than eight characters, one uppercase, one lowercase, one special character."""
    errs = []
    if len(p) <= 8:
        errs.append("must be more than 8 characters")
    if not re.search(r"[A-Z]", p):
        errs.append("needs an uppercase letter")
    if not re.search(r"[a-z]", p):
        errs.append("needs a lowercase letter")
    if not re.search(r"[^A-Za-z0-9]", p):
        errs.append("needs a special character")
    return errs


def make_token(user_id: int, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    return jwt.encode({"sub": str(user_id), "role": role, "exp": exp}, SECRET, algorithm="HS256")


def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET, algorithms=["HS256"])
