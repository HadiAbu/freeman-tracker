from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings
from app.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)
_CHALLENGE = {"WWW-Authenticate": "Bearer"}


def current_user_id(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> int:
    """The signed-in user's id, from a valid access token. Every data route depends on this, and
    every query it runs is filtered by the id it returns: it is the only source of user_id."""
    if not settings.jwt_secret:
        # Fail closed: a server without a signing secret must not accept anything.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured")
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in", headers=_CHALLENGE)
    user_id = decode_access_token(creds.credentials, settings.jwt_secret)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired", headers=_CHALLENGE)
    return user_id
