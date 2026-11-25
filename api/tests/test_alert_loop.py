import threading

from fastapi.testclient import TestClient

from app import alert_loop, main
from app.alerts import CheckResult
from app.config import get_settings
from app.db import connect, get_conn, init_schema
from tests.conftest import make_settings


def configured(**over):
    settings = make_settings(
        finnhub_api_key="fh", smtp_user="me@gmail.com", smtp_password="pw", **over
    )
    # model_copy skips validation: 1 s is below the allowed minimum, but keeps these tests fast.
    return settings.model_copy(update={"alert_check_seconds": 1})


def test_it_does_not_start_without_a_market_data_key():
    stop = threading.Event()
    assert alert_loop.start_alert_loop(
        make_settings(smtp_user="me@gmail.com", smtp_password="pw"), lambda: None, stop
    ) is None


def test_it_does_not_start_without_mail_settings():
    stop = threading.Event()
    assert alert_loop.start_alert_loop(make_settings(finnhub_api_key="fh"), lambda: None, stop) is None


def test_it_runs_a_check_and_stops_when_asked(monkeypatch):
    called = threading.Event()

    class Conn:
        closed = False

        def close(self):
            Conn.closed = True

    def fake_check(conn, quotes, cache, mailer, now, **kw):
        called.set()
        return CheckResult()

    monkeypatch.setattr(alert_loop, "run_check", fake_check)
    stop = threading.Event()
    t = alert_loop.start_alert_loop(configured(), Conn, stop)
    assert t is not None and t.daemon
    assert called.wait(5)
    stop.set()
    t.join(5)
    assert not t.is_alive() and Conn.closed


def test_an_error_in_one_check_does_not_end_the_loop(monkeypatch):
    calls = []
    second = threading.Event()

    def flaky(conn, quotes, cache, mailer, now, **kw):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")
        second.set()
        return CheckResult()

    monkeypatch.setattr(alert_loop, "run_check", flaky)
    stop = threading.Event()
    t = alert_loop.start_alert_loop(configured(), lambda: type("C", (), {"close": lambda s: None})(), stop)
    assert second.wait(5)  # it kept going after the first check raised
    stop.set()
    t.join(5)


def test_the_server_starts_the_loop_with_the_app_and_stops_it_on_shutdown(monkeypatch, tmp_path):
    db = str(tmp_path / "t.db")
    init_schema(connect(db))
    seen = {}

    def fake_start(settings, open_conn, stop):
        seen["stop"] = stop
        return None

    monkeypatch.setattr(main, "start_alert_loop", fake_start)

    def _conn():
        yield connect(db)

    main.app.dependency_overrides[get_conn] = _conn
    main.app.dependency_overrides[get_settings] = lambda: make_settings()
    try:
        with TestClient(main.app):
            assert not seen["stop"].is_set()
        assert seen["stop"].is_set()
    finally:
        main.app.dependency_overrides.clear()
