from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, field_validator

Origin = Literal["finnhub_company", "finnhub_market", "gdelt"]


class NewsItem(BaseModel):
    id: str
    title: str
    source: str
    published_at: datetime | None  # timezone-aware UTC when present
    url: str  # always a canonical http(s) URL
    snippet: str  # plain text, may be empty (GDELT has none)
    origin: Origin

    @field_validator("url")
    @classmethod
    def _http_url(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("url must be an http(s) URL")
        return v

    @field_validator("published_at")
    @classmethod
    def _utc(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)


class NewsSourceError(Exception):
    """A news provider failed. The message never contains URLs, tokens or response bodies."""

    def __init__(self, source: str, reason: str):
        super().__init__(f"{source}: {reason}")
        self.source = source
        self.reason = reason
