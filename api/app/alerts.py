"""Price alerts: when a limit counts as reached, and what state a limit starts in."""

ARMED = "armed"  # will email the next time the price reaches the limit
TRIGGERED = "triggered"  # already past the limit; quiet until the price crosses back


def beyond(side: str, price: float, limit: float) -> bool:
    """True when `price` has reached `limit`. Reaching it counts: >= for upper, <= for lower."""
    return price >= limit if side == "upper" else price <= limit


def initial_state(side: str, price: float | None, limit: float | None) -> str:
    """State for a limit that was just created or changed.

    A limit the price is already past starts 'triggered', so setting it never sends an email about
    something that was already true. It emails only after the price comes back and crosses again.
    """
    if limit is None or price is None:
        return ARMED
    return TRIGGERED if beyond(side, price, limit) else ARMED
