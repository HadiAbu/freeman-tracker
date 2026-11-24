import secrets

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings


def require_api_key(
    x_api_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    if not settings.api_key:
        # Fail closed: an unconfigured server must not be open.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "API key not configured")
    # Compare bytes: compare_digest raises TypeError on non-ASCII str, which would turn a
    # malformed header (Starlette decodes headers as latin-1) into a 500 instead of a 401.
    if x_api_key is None or not secrets.compare_digest(
        x_api_key.encode("utf-8"), settings.api_key.encode("utf-8")
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing API key")
