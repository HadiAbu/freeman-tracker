import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from app.auth import current_user_id
from app.config import Settings, get_settings
from app.db import get_conn, one
from app.ratelimit import LoginThrottle
from app.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 10
MAX_PASSWORD = 128  # argon2 is deliberately slow; an unbounded password is a cheap way to hurt the server

# One shared throttle per process, built lazily from settings (and replaceable in tests).
_throttle: LoginThrottle | None = None


def get_throttle(settings: Settings = Depends(get_settings)) -> LoginThrottle:
    global _throttle
    if _throttle is None:
        _throttle = LoginThrottle(settings.login_max_failures, settings.login_window_seconds)
    return _throttle


def reset_throttle() -> None:
    global _throttle
    _throttle = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class Credentials(BaseModel):
    email: str
    password: str = Field(max_length=MAX_PASSWORD)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if len(v) > 254 or not _EMAIL.match(v):
            raise ValueError("enter a valid email address")
        return v


class RegisterIn(Credentials):
    password: str = Field(min_length=MIN_PASSWORD, max_length=MAX_PASSWORD)


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=512)


def _issue_tokens(conn, settings: Settings, user_id: int, family_id: str) -> dict:
    now = utcnow()
    refresh = new_refresh_token()
    conn.execute(
        "INSERT INTO refresh_tokens (user_id, family_id, token_hash, created_at, expires_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            user_id, family_id, hash_token(refresh), _iso(now),
            _iso(now + timedelta(days=settings.refresh_token_days)),
        ),
    )
    conn.commit()
    return {
        "access_token": create_access_token(
            user_id, settings.jwt_secret, settings.access_token_minutes, now
        ),
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.access_token_minutes * 60,
    }


def _require_configured(settings: Settings) -> None:
    if not settings.jwt_secret:
        raise HTTPException(503, "Authentication is not configured")


@router.post("/register", status_code=201)
def register(body: RegisterIn, conn=Depends(get_conn), settings: Settings = Depends(get_settings)):
    _require_configured(settings)
    if not settings.allow_registration:
        raise HTTPException(403, "Registration is closed")
    if one(conn.execute("SELECT id FROM users WHERE email = ?", (body.email,))):
        raise HTTPException(409, "An account with this email already exists")
    cur = conn.execute(
        "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
        (body.email, hash_password(body.password), _iso(utcnow())),
    )
    conn.commit()
    return _issue_tokens(conn, settings, cur.lastrowid, uuid.uuid4().hex)


@router.post("/login")
def login(
    body: Credentials,
    request: Request,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    throttle: LoginThrottle = Depends(get_throttle),
):
    _require_configured(settings)
    # Throttle by account and by caller, so one address cannot try many accounts and one account
    # cannot be hammered from many addresses without both limits eventually biting.
    client = request.client.host if request.client else "unknown"
    keys = (f"email:{body.email}", f"ip:{client}")
    wait = max(throttle.retry_after(k) for k in keys)
    if wait:
        raise HTTPException(
            429, "Too many failed sign-in attempts. Try again later.", headers={"Retry-After": str(wait)}
        )

    user = one(conn.execute("SELECT id, password_hash FROM users WHERE email = ?", (body.email,)))
    if not verify_password(user["password_hash"] if user else None, body.password):
        for k in keys:
            throttle.record_failure(k)
        # Same message whether the email exists or not.
        raise HTTPException(401, "Incorrect email or password")

    throttle.reset(keys[0])
    return _issue_tokens(conn, settings, user["id"], uuid.uuid4().hex)


@router.post("/refresh")
def refresh(body: RefreshIn, conn=Depends(get_conn), settings: Settings = Depends(get_settings)):
    _require_configured(settings)
    row = one(
        conn.execute(
            "SELECT id, user_id, family_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?",
            (hash_token(body.refresh_token),),
        )
    )
    invalid = HTTPException(401, "Session expired. Sign in again.")
    if row is None:
        raise invalid
    if row["revoked_at"] is not None:
        # A used token came back: either a replay of a stolen token or a confused client.
        # Either way, end every session in this family.
        conn.execute(
            "UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL",
            (_iso(utcnow()), row["family_id"]),
        )
        conn.commit()
        raise invalid
    now = utcnow()
    if row["expires_at"] <= _iso(now):
        raise invalid
    conn.execute("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?", (_iso(now), row["id"]))
    conn.commit()
    return _issue_tokens(conn, settings, row["user_id"], row["family_id"])


@router.post("/logout", status_code=204)
def logout(body: RefreshIn, conn=Depends(get_conn)):
    """Ends this session. Always 204, so it cannot be used to test whether a token exists."""
    conn.execute(
        "UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
        (_iso(utcnow()), hash_token(body.refresh_token)),
    )
    conn.commit()
    return Response(status_code=204)


@router.get("/me")
def me(user_id: int = Depends(current_user_id), conn=Depends(get_conn)):
    user = one(conn.execute("SELECT id, email FROM users WHERE id = ?", (user_id,)))
    if user is None:
        # A valid token for an account that no longer exists.
        raise HTTPException(401, "Session expired", headers={"WWW-Authenticate": "Bearer"})
    return user
