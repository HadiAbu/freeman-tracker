from app.alert_email import AlertDetails, compose


def details(**over):
    base = dict(
        ticker="AAPL", name="Apple Inc", side="upper", price=190.12, limit=190.0,
        upper_limit=190.0, lower_limit=150.0, previous_close=186.76, note="Wait for earnings",
        checked_at="2026-11-25 15:42 UTC", last_trade_day=None, cooldown_seconds=3600,
    )
    base.update(over)
    return AlertDetails(**base)


def test_an_upper_limit_email_has_every_detail():
    subject, body = compose(details())
    assert subject == "AAPL rose above your upper limit ($190.00)"
    assert "Apple Inc (AAPL) is $190.12, above your upper limit of $190.00 (+0.06%)." in body
    assert "Today:        +1.8% vs yesterday's close of $186.76" in body
    assert "Your limits:  lower $150.00 · upper $190.00" in body
    assert "Your note:    Wait for earnings" in body
    assert "Price as of:  2026-11-25 15:42 UTC (Finnhub)" in body
    assert "at most once an hour" in body


def test_a_lower_limit_email_says_fell_below():
    subject, body = compose(details(side="lower", price=149.0, limit=150.0))
    assert subject == "AAPL fell below your lower limit ($150.00)"
    assert "is $149.00, below your lower limit of $150.00 (-0.67%)." in body


def test_missing_data_leaves_its_line_out():
    _, body = compose(
        details(name=None, note=None, previous_close=None, lower_limit=None, upper_limit=190.0)
    )
    assert body.startswith("AAPL is $190.12, above")
    assert "Your note" not in body and "Today:" not in body
    assert "Your limits:  upper $190.00" in body


def test_a_last_trade_on_an_earlier_day_is_mentioned():
    _, body = compose(details(last_trade_day="2026-11-24"))
    assert "(Finnhub, last trade 2026-11-24)" in body


def test_the_cooldown_text_follows_the_setting():
    assert "at most once every 30 minutes" in compose(details(cooldown_seconds=1800))[1]
    assert "at most once every 2 hours" in compose(details(cooldown_seconds=7200))[1]


def test_free_text_cannot_break_out_of_its_line_or_reach_the_subject():
    subject, body = compose(
        details(name="Evil\r\nBcc: someone@else.com", note="line one\nline two", ticker="AAPL\nX")
    )
    assert "\n" not in subject and "\r" not in subject
    assert "Bcc: someone@else.com" in body  # kept as text...
    assert "\nBcc:" not in body  # ...but never at the start of a line
    assert "line one line two" in body


def test_nothing_about_holdings_is_in_the_text():
    subject, body = compose(details())
    text = (subject + body).lower()
    for word in ("shares", "cost basis", "balance", "portfolio"):
        assert word not in text
