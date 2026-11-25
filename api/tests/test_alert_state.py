import pytest

from app.alerts import ARMED, TRIGGERED, beyond, initial_state


@pytest.mark.parametrize(
    "side,price,limit,expected",
    [
        ("upper", 190, 190, True),  # reaching the limit counts
        ("upper", 189.99, 190, False),
        ("upper", 200, 190, True),
        ("lower", 150, 150, True),
        ("lower", 150.01, 150, False),
        ("lower", 100, 150, True),
    ],
)
def test_beyond(side, price, limit, expected):
    assert beyond(side, price, limit) is expected


def test_a_new_limit_the_price_is_already_past_starts_triggered():
    assert initial_state("upper", 200, 190) == TRIGGERED
    assert initial_state("lower", 100, 150) == TRIGGERED


def test_a_new_limit_the_price_has_not_reached_starts_armed():
    assert initial_state("upper", 180, 190) == ARMED
    assert initial_state("lower", 180, 150) == ARMED


def test_no_price_or_no_limit_starts_armed():
    assert initial_state("upper", None, 190) == ARMED
    assert initial_state("upper", 180, None) == ARMED
