"""Pure portfolio math (no I/O). Average-cost method.

Trades are processed in (traded_at, id) order. A sell that exceeds the shares
held at that point raises OversellError, so the API can reject bad edits.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, Literal

EPS = 1e-9


class OversellError(ValueError):
    pass


@dataclass(frozen=True)
class Trade:
    id: int
    ticker: str
    side: Literal["buy", "sell"]
    shares: float
    price: float
    fee: float
    traded_at: date


@dataclass
class Position:
    ticker: str
    shares: float = 0.0
    cost_basis: float = 0.0  # total cost of shares still held (fees included)
    realized_pnl: float = 0.0
    last_trade_price: float | None = None

    @property
    def avg_cost(self) -> float:
        return self.cost_basis / self.shares if self.shares > EPS else 0.0


def _ordered(trades: Iterable[Trade]) -> list[Trade]:
    return sorted(trades, key=lambda t: (t.traded_at, t.id))


def _apply(positions: dict[str, Position], t: Trade) -> None:
    pos = positions.setdefault(t.ticker, Position(t.ticker))
    if t.side == "buy":
        pos.shares += t.shares
        pos.cost_basis += t.shares * t.price + t.fee
    else:
        if t.shares > pos.shares + EPS:
            raise OversellError(
                f"Sell of {t.shares} {t.ticker} on {t.traded_at} exceeds {pos.shares} held"
            )
        avg = pos.avg_cost
        pos.realized_pnl += (t.shares * t.price - t.fee) - avg * t.shares
        pos.cost_basis -= avg * t.shares
        pos.shares -= t.shares
        if pos.shares <= EPS:  # fully closed: clear float dust
            pos.shares = 0.0
            pos.cost_basis = 0.0
    pos.last_trade_price = t.price


def compute_positions(trades: Iterable[Trade]) -> dict[str, Position]:
    """All positions (including fully closed ones, which carry realized P&L)."""
    positions: dict[str, Position] = {}
    for t in _ordered(trades):
        _apply(positions, t)
    return positions


@dataclass
class Holding:
    ticker: str
    shares: float
    avg_cost: float
    cost_basis: float
    price: float
    price_source: Literal["price", "trade"]  # where `price` came from
    market_value: float
    unrealized_pnl: float
    unrealized_pct: float
    realized_pnl: float
    name: str | None = None
    sector: str | None = None
    asset_class: str | None = None


@dataclass
class Summary:
    total_value: float
    total_cost: float
    unrealized_pnl: float
    unrealized_pct: float
    realized_pnl: float
    holdings: list[Holding] = field(default_factory=list)


def build_summary(
    positions: dict[str, Position],
    prices: dict[str, float],
    meta: dict[str, dict] | None = None,
) -> Summary:
    """Value open positions. `prices` = latest manual price per ticker; falls back
    to the last trade price so a position is never valued at zero."""
    meta = meta or {}
    holdings: list[Holding] = []
    for pos in positions.values():
        if pos.shares <= EPS:
            continue
        if pos.ticker in prices:
            price, source = prices[pos.ticker], "price"
        else:
            price, source = pos.last_trade_price or 0.0, "trade"
        value = pos.shares * price
        pnl = value - pos.cost_basis
        m = meta.get(pos.ticker, {})
        holdings.append(
            Holding(
                ticker=pos.ticker,
                shares=pos.shares,
                avg_cost=pos.avg_cost,
                cost_basis=pos.cost_basis,
                price=price,
                price_source=source,
                market_value=value,
                unrealized_pnl=pnl,
                unrealized_pct=(pnl / pos.cost_basis * 100) if pos.cost_basis > EPS else 0.0,
                realized_pnl=pos.realized_pnl,
                name=m.get("name"),
                sector=m.get("sector"),
                asset_class=m.get("asset_class"),
            )
        )
    holdings.sort(key=lambda h: h.market_value, reverse=True)
    total_value = sum(h.market_value for h in holdings)
    total_cost = sum(h.cost_basis for h in holdings)
    unrealized = total_value - total_cost
    return Summary(
        total_value=total_value,
        total_cost=total_cost,
        unrealized_pnl=unrealized,
        unrealized_pct=(unrealized / total_cost * 100) if total_cost > EPS else 0.0,
        realized_pnl=sum(p.realized_pnl for p in positions.values()),
        holdings=holdings,
    )


def first_trade_order(trades: Iterable[Trade]) -> list[str]:
    """Every ticker ever traded (closed positions included), by date of first trade."""
    seen: list[str] = []
    for t in _ordered(trades):
        if t.ticker not in seen:
            seen.append(t.ticker)
    return seen


def allocation(
    summary: Summary,
    by: Literal["ticker", "sector", "asset_class"],
    order: list[str] | None = None,
    meta: dict[str, dict] | None = None,
) -> list[dict]:
    """Pie-chart slices: label, value, percent, slot. Missing metadata -> 'Unassigned'.

    `slot` is a stable identity index for the label (the client maps it to a palette color).
    It comes from the all-time first-trade `order` of every ticker ever traded, so it does not
    change when positions grow, shrink, or close. A group takes the earliest first-trade among
    its tickers, closed ones included (`meta` covers closed tickers too)."""
    meta = meta or {}
    order = order if order is not None else [h.ticker for h in summary.holdings]

    def label_of(ticker: str) -> str:
        return ticker if by == "ticker" else ((meta.get(ticker) or {}).get(by) or "Unassigned")

    first_seen: dict[str, int] = {}
    for i, ticker in enumerate(order):
        first_seen.setdefault(label_of(ticker), i)
    slots = {label: i for i, label in enumerate(sorted(first_seen, key=first_seen.get))}

    buckets: dict[str, float] = {}
    for h in summary.holdings:
        label = h.ticker if by == "ticker" else (getattr(h, by) or "Unassigned")
        buckets[label] = buckets.get(label, 0.0) + h.market_value
    total = sum(buckets.values())
    slices = [
        {
            "label": k,
            "value": v,
            "percent": (v / total * 100) if total > EPS else 0.0,
            # a label with no ordering info (shouldn't happen) sorts after all known ones
            "slot": slots.get(k, len(slots)),
        }
        for k, v in buckets.items()
    ]
    return sorted(slices, key=lambda s: s["value"], reverse=True)


def value_history(
    trades: Iterable[Trade], price_points: Iterable[tuple[str, date, float]]
) -> list[dict]:
    """Portfolio value on each date that has a trade, or a price mark for a ticker held that day.

    Price on a date = latest manual price on/before it, else the latest trade price on/before
    it. Marks for tickers you never held (watchlist-only), and anything before the first trade,
    produce no point. Single pass over the sorted trades and marks. `price_points` =
    (ticker, as_of, price)."""
    trades = _ordered(trades)
    if not trades:
        return []
    points = sorted(price_points, key=lambda p: p[1])
    first_day = trades[0].traded_at
    trade_days = {t.traded_at for t in trades}
    days = sorted(trade_days | {p[1] for p in points if p[1] >= first_day})

    positions: dict[str, Position] = {}
    latest: dict[str, float] = {}
    ti = pi = 0
    out: list[dict] = []
    for d in days:
        while ti < len(trades) and trades[ti].traded_at <= d:
            _apply(positions, trades[ti])
            ti += 1
        held_mark_today = False
        while pi < len(points) and points[pi][1] <= d:
            ticker, as_of, price = points[pi]
            latest[ticker] = price
            pos = positions.get(ticker)
            if as_of == d and pos is not None and pos.shares > EPS:
                held_mark_today = True
            pi += 1
        if d in trade_days or held_mark_today:
            summary = build_summary(positions, latest)
            out.append(
                {"date": d.isoformat(), "value": summary.total_value, "cost": summary.total_cost}
            )
    return out
