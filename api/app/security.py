"""Password hashing and token helpers. No database or HTTP in here, so it is easy to test."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()  # argon2id with the library's current recommended parameters

# Hashed once at import. Verifying against it when an email is unknown makes "no such user" cost
# the same as "wrong password", so response time does not reveal which emails have accounts.
_DUMMY_HASH = _hasher.hash("not-a-real-password")

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        ok = _hasher.verify(password_hash or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return ok and password_hash is not None


def create_access_token(user_id: int, secret: str, minutes: int, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    claims = {
        "sub": str(user_id),
        "typ": "access",
        "iat": now,
        "exp": now + timedelta(minutes=minutes),
    }
    return jwt.encode(claims, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, secret: str) -> int | None:
    """The user id, or None for anything wrong: bad signature, expired, wrong kind, malformed."""
    try:
        claims = jwt.decode(
            token, secret, algorithms=[ALGORITHM], options={"require": ["exp", "sub", "typ"]}
        )
        if claims.get("typ") != "access":
            return None
        return int(claims["sub"])
    except (jwt.PyJWTError, ValueError, TypeError):
        return None


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """Refresh tokens are long random values, so a fast hash is enough; the database never holds
    anything that can be replayed."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
