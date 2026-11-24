import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

Stance = Literal["buy", "hold", "sell", "unclear"]
Confidence = Literal["low", "medium", "high"]
_TICKER = re.compile(r"^[A-Z0-9.\-]{1,15}$")


class CasePoint(BaseModel):
    point: str
    source_ids: list[str]


class LlmAnalysis(BaseModel):
    """What the model must return (all fields required: this is the structured-output schema)."""

    stance: Stance
    confidence: Confidence
    summary: str
    case_for: list[CasePoint]
    case_against: list[CasePoint]
    watch_for: list[str]


class SourceOut(BaseModel):
    id: str
    title: str
    source: str
    published_at: datetime | None
    url: str
    origin: Literal["finnhub_company", "finnhub_market", "gdelt"]


class Analysis(BaseModel):
    ticker: str
    generated_at: datetime
    cached: bool
    personalized: bool
    stance: Stance
    confidence: Confidence
    summary: str
    case_for: list[CasePoint]
    case_against: list[CasePoint]
    watch_for: list[str]
    sources: list[SourceOut]
    notes: list[str]
    model: str


class AnalysisRequest(BaseModel):
    ticker: str
    refresh: bool = False
    personalize: bool = True

    @field_validator("ticker")
    @classmethod
    def _ticker_ok(cls, v: str) -> str:
        v = v.strip().upper()
        if not _TICKER.match(v):
            raise ValueError("ticker must be 1-15 letters, digits, '.' or '-'")
        return v
