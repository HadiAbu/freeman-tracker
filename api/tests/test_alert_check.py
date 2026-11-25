from datetime import date, datetime, timedelta, timezone

import pytest

from app.alerts import decide, run_check
from app.mailer import MailError
from app.quotes import Quote, QuoteCache, QuoteError

NOW = datetime(2026, 11, 25, 15, 42, tzinfo=timezone.utc)
HOUR = 3600


# ---------- decide: the state machine on its own ----------
@pytest.mark.parametrize(
    "side,state,price,limit,last,expected",
    [
        ("upper", "armed", 191, 190, None, "send"),
        ("upper", "armed", 190, 190, None, "send"),  # reaching it counts
        ("upper", "armed", 189, 190, None, "none"),
        ("upper", "triggered", 191, 190, None, "none"),  # already told: stay quiet while beyond
        ("upper", "triggered", 189, 190, None, "rearm"),  # back inside
        ("lower", "armed", 149, 150, None, "send"),
        ("lower", "triggered", 151, 150, None, "rearm"),
        ("upper", "armed", 191, 190, NOW - timedelta(minutes=59), "none"),  # cooldown
        ("upper", "armed", 191, 190, NOW - timedelta(minutes=61), "send"),
    ],
)
def test_decide(side, state, price, limit, last, expected):
    assert decide(side, state, price, limit, last, NOW, HOUR) == expected


# ---------- run_check with fakes ----------
class FakeQuotes:
    def __init__(self, prices, previous=186.76):
        self.prices, self.previous, self.calls = prices, previous, []

    def quote(self, ticker):
        self.calls.append(ticker)
        if ticker not in self.prices:
            raise QuoteError("no quote for this symbol")
        return Quote(ticker, self.prices[ticker], date(2026, 11, 25), self.previous)


class FakeMailer:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    def send(self, to, subject, body):
        if self.fail:
            raise MailError("email could not be sent (SMTPAuthenticationError)")
        self.sent.append((to, subject, body))


def add_user(conn, email, alert_email="me@example.com"):
    cur = conn.execute(
        "INSERT INTO users (email, password_hash, created_at, alert_email) VALUES (?, 'x', 'now', ?)",
        (email, alert_email),
    )
    conn.commit()
    return cur.lastrowid


def add_watch(conn, user_id, ticker="AAPL", upper=None, lower=None, name="Apple Inc", note=None,
              upper_state="armed", lower_state="armed", last=None):
    conn.execute(
        "INSERT INTO watchlist (user_id, ticker, name, upper_limit, lower_limit, upper_state,"
        " lower_state, last_alerted_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, ticker, name, upper, lower, upper_state, lower_state, last, note),
    )
    conn.commit()


def state(conn, ticker="AAPL", user_id=1):
    return conn.execute(
        "SELECT upper_state, lower_state, last_alerted_at FROM watchlist WHERE ticker = ? AND user_id = ?",
        (ticker, user_id),
    ).fetchone()


def check(conn, quotes, mailer, now=NOW, cache=None, **kw):
    return run_check(conn, quotes, cache or QuoteCache(0), mailer, now, cooldown_seconds=HOUR, **kw)


def test_it_emails_once_when_a_limit_is_reached_and_marks_it_triggered(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190, lower=150, note="Wait for earnings")
    mailer = FakeMailer()
    result = check(db_conn, FakeQuotes({"AAPL": 190.12}), mailer)
    assert result.sent == 1 and len(mailer.sent) == 1
    to, subject, body = mailer.sent[0]
    assert to == "me@example.com"
    assert subject == "AAPL rose above your upper limit ($190.00)"
    assert "Wait for earnings" in body and "+1.8% vs yesterday's close of $186.76" in body
    assert state(db_conn) == ("triggered", "armed", NOW.isoformat())
    # the same price on the next cycle sends nothing
    assert check(db_conn, FakeQuotes({"AAPL": 190.12}), mailer, now=NOW + timedelta(minutes=2)).sent == 0
    assert len(mailer.sent) == 1


def test_it_rearms_when_the_price_returns_and_emails_again_after_the_cooldown(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    mailer = FakeMailer()
    check(db_conn, FakeQuotes({"AAPL": 191}), mailer)
    r = check(db_conn, FakeQuotes({"AAPL": 185}), mailer, now=NOW + timedelta(minutes=10))
    assert r.rearmed == 1 and state(db_conn)[0] == "armed"
    # crosses again inside the hour: held back by the cooldown, still armed
    r = check(db_conn, FakeQuotes({"AAPL": 192}), mailer, now=NOW + timedelta(minutes=20))
    assert r.sent == 0 and state(db_conn)[0] == "armed"
    # after the cooldown the next check sends it
    r = check(db_conn, FakeQuotes({"AAPL": 192}), mailer, now=NOW + timedelta(minutes=65))
    assert r.sent == 1 and len(mailer.sent) == 2


def test_a_lower_limit_sends_the_fell_below_email(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190, lower=150)
    mailer = FakeMailer()
    check(db_conn, FakeQuotes({"AAPL": 149}), mailer)
    assert mailer.sent[0][1] == "AAPL fell below your lower limit ($150.00)"
    assert state(db_conn)[:2] == ("armed", "triggered")


def test_a_failed_send_leaves_the_limit_armed_so_the_next_cycle_retries(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    r = check(db_conn, FakeQuotes({"AAPL": 191}), FakeMailer(fail=True))
    assert r.failed_emails == 1 and r.sent == 0
    assert state(db_conn) == ("armed", "armed", None)
    mailer = FakeMailer()
    assert check(db_conn, FakeQuotes({"AAPL": 191}), mailer, now=NOW + timedelta(minutes=2)).sent == 1


@pytest.mark.parametrize("alert_email,use_mailer", [(None, True), ("me@example.com", False)])
def test_without_a_destination_the_alert_stays_armed_and_is_counted(db_conn, alert_email, use_mailer):
    uid = add_user(db_conn, "a@x.com", alert_email=alert_email)
    add_watch(db_conn, uid, upper=190)
    r = check(db_conn, FakeQuotes({"AAPL": 191}), FakeMailer() if use_mailer else None)
    assert r.waiting_for_destination == 1 and r.sent == 0
    assert state(db_conn)[0] == "armed"


def test_a_ticker_that_cannot_be_quoted_does_not_stop_the_others(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, "ZZZZ", upper=10)
    add_watch(db_conn, uid, "AAPL", upper=190)
    mailer = FakeMailer()
    r = check(db_conn, FakeQuotes({"AAPL": 191}), mailer)
    assert r.quote_failures == 1 and r.sent == 1
    assert state(db_conn, "ZZZZ") == ("armed", "armed", None)


def test_two_users_watching_one_ticker_cost_one_quote_and_each_gets_an_email(db_conn):
    a, b = add_user(db_conn, "a@x.com", "a@example.com"), add_user(db_conn, "b@x.com", "b@example.com")
    add_watch(db_conn, a, upper=190)
    add_watch(db_conn, b, upper=180)
    quotes, mailer = FakeQuotes({"AAPL": 191}), FakeMailer()
    r = check(db_conn, quotes, mailer)
    assert quotes.calls == ["AAPL"] and r.sent == 2
    assert sorted(m[0] for m in mailer.sent) == ["a@example.com", "b@example.com"]


def test_ticker_with_no_limits_is_never_quoted(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=None, lower=None)
    quotes = FakeQuotes({"AAPL": 1})
    check(db_conn, quotes, FakeMailer())
    assert quotes.calls == []


def test_it_stores_the_quote_as_a_shared_market_price(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    check(db_conn, FakeQuotes({"AAPL": 191}), FakeMailer())
    assert db_conn.execute(
        "SELECT user_id, price, source FROM prices WHERE ticker = 'AAPL'"
    ).fetchall() == [(None, 191.0, "market")]


def test_a_fresh_cached_quote_is_used_but_an_old_one_is_not(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    now = [0.0]
    cache = QuoteCache(120, clock=lambda: now[0])
    cache.put(Quote("AAPL", 191.0, date(2026, 11, 25)))
    quotes = FakeQuotes({"AAPL": 195})
    now[0] = 30
    check(db_conn, quotes, FakeMailer(), cache=cache)
    assert quotes.calls == []  # 30 s old: used
    now[0] = 90
    check(db_conn, quotes, FakeMailer(), now=NOW + timedelta(hours=2), cache=cache)
    assert quotes.calls == ["AAPL"]  # 90 s old: too stale for the checker


def test_at_most_max_emails_go_out_in_one_cycle(db_conn):
    uid = add_user(db_conn, "a@x.com")
    for t in ("AAA", "BBB", "CCC"):
        add_watch(db_conn, uid, t, upper=1)
    mailer = FakeMailer()
    r = check(db_conn, FakeQuotes({"AAA": 2, "BBB": 2, "CCC": 2}), mailer, max_emails=2)
    assert r.sent == 2
    assert check(db_conn, FakeQuotes({"AAA": 2, "BBB": 2, "CCC": 2}), mailer, max_emails=2).sent == 1


def test_a_last_trade_on_another_day_is_mentioned_in_the_email(db_conn):
    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, upper=190)
    later = NOW + timedelta(days=2)  # checked two days after the last trade (a weekend)
    mailer = FakeMailer()
    check(db_conn, FakeQuotes({"AAPL": 191}), mailer, now=later)
    assert "last trade 2026-11-25" in mailer.sent[0][2]


def test_an_unexpected_error_mid_cycle_keeps_the_emails_already_sent_committed(db_conn, tmp_path):
    from app.db import connect

    uid = add_user(db_conn, "a@x.com")
    add_watch(db_conn, uid, "AAA", upper=1)
    add_watch(db_conn, uid, "BBB", upper=1)

    class ExplodingMailer:
        def __init__(self):
            self.calls = 0

        def send(self, to, subject, body):
            self.calls += 1
            if self.calls == 2:
                raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        check(db_conn, FakeQuotes({"AAA": 2, "BBB": 2}), ExplodingMailer())
    other = connect(str(tmp_path / "unit.db"))
    assert state(other, "AAA")[0] == "triggered"
    assert state(other, "BBB")[0] == "armed"
