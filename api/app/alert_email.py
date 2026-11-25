"""The text of an alert email. Pure (no network), so every line is easy to test.

What goes in: ticker, company name, price, limits, change since the previous close, the user's own
note and the check time. What never does: share counts, cost basis, balances, portfolio value.
Email is not private, and an alert does not need them.
"""

import re
from dataclasses import dataclass

_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


def clean(text: str, limit: int = 200) -> str:
    """Free text on one line: control characters (newlines included) become spaces."""
    return _CONTROL.sub(" ", text).strip()[:limit]


def money(x: float) -> str:
    return f"${x:,.2f}"


def _every(seconds: int) -> str:
    if seconds % 3600 == 0:
        hours = seconds // 3600
        return "once an hour" if hours == 1 else f"once every {hours} hours"
    return f"once every {max(1, round(seconds / 60))} minutes"


@dataclass(frozen=True)
class AlertDetails:
    ticker: str
    name: str | None
    side: str  # "upper" or "lower"
    price: float
    limit: float  # the limit that was reached
    upper_limit: float | None
    lower_limit: float | None
    previous_close: float | None
    note: str | None
    checked_at: str  # e.g. "2026-11-25 15:42 UTC"
    last_trade_day: str | None  # set only when the last trade was not today (weekend, holiday)
    cooldown_seconds: int


def compose(d: AlertDetails) -> tuple[str, str]:
    """Returns (subject, body). The subject holds only the ticker and numbers."""
    above = d.side == "upper"
    ticker = clean(d.ticker, 15)
    word = "rose above your upper limit" if above else "fell below your lower limit"
    subject = f"{ticker} {word} ({money(d.limit)})"

    name = clean(d.name) if d.name else ""
    who = f"{name} ({ticker})" if name else ticker
    past = (d.price - d.limit) / d.limit * 100
    direction = "above" if above else "below"
    lines = [
        f"{who} is {money(d.price)}, {direction} your {d.side} limit of {money(d.limit)} ({past:+.2f}%).",
        "",
    ]

    def row(label: str, value: str) -> None:
        lines.append(f"{label:<14}{value}")

    if d.previous_close:
        change = (d.price - d.previous_close) / d.previous_close * 100
        row("Today:", f"{change:+.1f}% vs yesterday's close of {money(d.previous_close)}")
    limits = []
    if d.lower_limit is not None:
        limits.append(f"lower {money(d.lower_limit)}")
    if d.upper_limit is not None:
        limits.append(f"upper {money(d.upper_limit)}")
    row("Your limits:", " · ".join(limits))
    note = clean(d.note) if d.note else ""
    if note:
        row("Your note:", note)
    trade = f", last trade {d.last_trade_day}" if d.last_trade_day else ""
    row("Price as of:", f"{d.checked_at} (Finnhub{trade})")
    lines += [
        "",
        "You will be emailed again only after the price returns between your limits and",
        f"crosses one again (at most {_every(d.cooldown_seconds)}). Change or remove limits in the app.",
    ]
    return subject, "\n".join(lines)
