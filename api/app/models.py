from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


# The largest share count, price, fee or limit accepted. Far above anything real, and small enough
# that sums and percentages cannot overflow to infinity. The app uses the same value (MAX_AMOUNT in
# src/lib/amount.ts).
MAX_AMOUNT = 1e12


def _amount(*args, **kwargs):
    """A number field with the shared upper bound. allow_inf_nan: JSON 1e400 parses to infinity,
    which can be stored but never sent back as JSON."""
    return Field(*args, le=MAX_AMOUNT, allow_inf_nan=False, **kwargs)


def _ticker(v: str) -> str:
    v = v.strip().upper()
    if not v or len(v) > 15:
        raise ValueError("ticker must be 1-15 characters")
    return v


class TradeIn(BaseModel):
    ticker: str
    side: Literal["buy", "sell"]
    shares: float = _amount(gt=0)
    price: float = _amount(ge=0)
    fee: float = _amount(default=0, ge=0)
    traded_at: date
    note: Optional[str] = None
    _t = field_validator("ticker")(_ticker)


class TradePatch(BaseModel):
    ticker: Optional[str] = None
    side: Optional[Literal["buy", "sell"]] = None
    shares: Optional[float] = _amount(default=None, gt=0)
    price: Optional[float] = _amount(default=None, ge=0)
    fee: Optional[float] = _amount(default=None, ge=0)
    traded_at: Optional[date] = None
    note: Optional[str] = None

    @field_validator("ticker")
    @classmethod
    def _t(cls, v):
        return None if v is None else _ticker(v)


class WatchIn(BaseModel):
    ticker: str
    name: Optional[str] = None
    # upper_limit: email when the price reaches it. lower_limit: email when it falls to it.
    upper_limit: Optional[float] = _amount(default=None, gt=0)
    lower_limit: Optional[float] = _amount(default=None, gt=0)
    note: Optional[str] = None
    _t = field_validator("ticker")(_ticker)


class WatchPatch(BaseModel):
    name: Optional[str] = None
    upper_limit: Optional[float] = _amount(default=None, gt=0)
    lower_limit: Optional[float] = _amount(default=None, gt=0)
    note: Optional[str] = None


class PriceIn(BaseModel):
    ticker: str
    price: float = _amount(ge=0)
    as_of: date
    source: str = "manual"
    _t = field_validator("ticker")(_ticker)


class HoldingMeta(BaseModel):
    name: Optional[str] = None
    sector: Optional[str] = None
    asset_class: Optional[str] = None
