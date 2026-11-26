
import logging
from datetime import datetime, timedelta, timezone

import pytest

from app import main
from app.analysis import routes
from app.analysis.llm import LlmUnavailable
from app.analysis import service
from app.analysis.schema import CasePoint, LlmAnalysis
from app.config import Settings, get_settings
from tests.conftest import make_settings
from app.db import connect
from app.news.models import NewsItem
from app.news.normalize import item_id
from app.news.service import NewsBundle

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)


def mk(n):
    url = f"https://example.com/{n}"
    return NewsItem(id=item_id(url), title=f"Headline {n}", source="Wire", published_at=NOW, url=url, snippet="x", origin="finnhub_company")


ITEMS = [mk(i) for i in range(1, 6)]


class FakeLlm:
    model = "fake-model"

    def __init__(self, error=None):
        self.error, self.inputs = error, []

    def analyze(self, instructions, input_text):
        self.inputs.append(input_text)
        if self.error:
            raise self.error
        return LlmAnalysis(
            stance="hold", confidence="medium", summary="Balanced.",
            case_for=[CasePoint(point="Strong demand", source_ids=[ITEMS[0].id])],
            case_against=[CasePoint(point="Valuation", source_ids=[ITEMS[1].id])], watch_for=["Earnings"])


@pytest.fixture(autouse=True)
def _reset_failed_attempts():
    service.reset_failed_attempts()
    yield
    service.reset_failed_attempts()


@pytest.fixture
def fakes(client, monkeypatch):
    llm = FakeLlm()
    state = {"items": ITEMS, "ok": True, "clock": NOW, "llm": llm}

    def gatherer_factory():
        def gather(ticker, name):
            return NewsBundle(items=list(state["items"]), notes=[], company_name=name, any_source_ok=state["ok"])
        return gather

    main.app.dependency_overrides[routes.get_news_gatherer] = gatherer_factory
    main.app.dependency_overrides[routes.get_llm] = lambda: state["llm"]
    monkeypatch.setattr(routes, "utcnow", lambda: state["clock"])
    return state


def post(client, **body):
    return client.post("/analysis", json={"ticker": "AAPL", **body})


def test_post_returns_a_cited_analysis_and_a_second_call_is_cached(client, fakes):
    r = post(client)
    assert r.status_code == 200
    a = r.json()
    assert a["ticker"] == "AAPL" and a["stance"] == "hold" and a["cached"] is False and a["personalized"] is False
    assert a["case_for"][0]["source_ids"] == [ITEMS[0].id]
    assert {s["id"] for s in a["sources"]} == {ITEMS[0].id, ITEMS[1].id} and "snippet" not in a["sources"][0]
    assert post(client).json()["cached"] is True
    assert len(fakes["llm"].inputs) == 1


def test_a_held_ticker_is_personalized_unless_turned_off(client, fakes):
    client.post("/trades", json={"ticker": "AAPL", "side": "buy", "shares": 10, "price": 100, "traded_at": "2026-01-01"})
    client.put("/holdings/AAPL", json={"name": "Apple Inc."})
    on = post(client).json()
    assert on["personalized"] is True and '"shares": 10' in fakes["llm"].inputs[0]
    assert '"company": "Apple Inc."' in fakes["llm"].inputs[0]
    off = post(client, personalize=False).json()
    assert off["personalized"] is False and '"position": null' in fakes["llm"].inputs[1]


def test_get_returns_the_latest_or_404(client, fakes):
    assert client.get("/analysis/AAPL").status_code == 404
    post(client)
    r = client.get("/analysis/aapl")
    assert r.status_code == 200 and r.json()["cached"] is True
    assert len(fakes["llm"].inputs) == 1  # GET never runs the pipeline


def test_refresh_too_soon_is_429_with_retry_after(client, fakes):
    post(client)
    fakes["clock"] = NOW + timedelta(minutes=5)
    r = post(client, refresh=True)
    assert r.status_code == 429 and r.headers["Retry-After"] == "600"
    fakes["clock"] = NOW + timedelta(minutes=16)
    assert post(client, refresh=True).status_code == 200


def test_daily_cap_is_429(client, fakes):
    main.app.dependency_overrides[get_settings] = lambda: make_settings(analysis_daily_cap=1)
    assert post(client).status_code == 200
    r = client.post("/analysis", json={"ticker": "MSFT"})
    assert r.status_code == 429 and "Retry-After" in r.headers


def test_thin_news_is_a_200_unclear_without_calling_the_model(client, fakes):
    fakes["items"] = ITEMS[:1]
    r = post(client)
    assert r.status_code == 200 and r.json()["stance"] == "unclear" and fakes["llm"].inputs == []


def test_all_news_failing_is_502(client, fakes):
    fakes["items"], fakes["ok"] = [], False
    assert post(client).status_code == 502


def test_model_failure_is_502_with_a_safe_message(client, fakes):
    fakes["llm"].error = LlmUnavailable("OpenAI rate limit or quota reached.")
    r = post(client)
    assert r.status_code == 502 and r.json()["detail"] == "OpenAI rate limit or quota reached."


def test_unconfigured_server_is_503_naming_only_the_missing_settings(client):
    # no key values at all, and the real .env is ignored: nothing here can reach a provider
    main.app.dependency_overrides[get_settings] = lambda: make_settings()
    r = post(client)
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert "OPENAI_API_KEY" in detail and "OPENAI_MODEL" in detail and "FINNHUB_API_KEY" in detail


def test_invalid_ticker_is_422_and_auth_is_required(client, anon, fakes):
    assert client.post("/analysis", json={"ticker": "A B"}).status_code == 422
    assert anon.post("/analysis", json={"ticker": "AAPL"}).status_code == 401
    assert anon.get("/analysis/AAPL").status_code == 401


def test_prompts_and_positions_are_never_logged(client, fakes, caplog):
    client.post("/trades", json={"ticker": "AAPL", "side": "buy", "shares": 10, "price": 100, "traded_at": "2026-01-01"})
    with caplog.at_level(logging.DEBUG):
        post(client)
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "Headline 1" not in text and "avg_cost" not in text and "sk-" not in text


def test_unexpected_exception_is_a_constant_500_that_leaks_nothing(client, fakes, caplog):
    def boom_factory():
        def gather(ticker, name):
            raise RuntimeError("SECRET-PROMPT-123")
        return gather

    main.app.dependency_overrides[routes.get_news_gatherer] = boom_factory
    with caplog.at_level(logging.DEBUG):
        r = post(client)
    assert r.status_code == 500
    assert r.json()["detail"] == "The analysis failed unexpectedly. Please try again."
    assert "SECRET-PROMPT-123" not in r.text
    assert "SECRET-PROMPT-123" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_inconsistent_ledger_still_passes_through_as_409(client, fakes):
    conn = connect(client.db_path)
    conn.execute(
        "INSERT INTO trades (user_id, ticker, side, shares, price, fee, traded_at) VALUES (1, 'AAPL', 'sell', 5, 100, 0, '2026-01-01')"
    )
    conn.commit()
    assert post(client).status_code == 409


def test_get_normalizes_ticker_and_rejects_invalid_ones(client, fakes):
    post(client)
    assert client.get("/analysis/%20aapl%20").status_code == 200
    assert client.get("/analysis/A%20B").status_code == 422
    assert client.get("/analysis/" + "A" * 16).status_code == 422
    assert client.get("/analysis/AA%27%3B--").status_code == 422


@pytest.mark.parametrize("fn", ["holding_for", "watchlist_name"])
def test_ledger_errors_before_the_pipeline_are_a_constant_500(client, fakes, caplog, monkeypatch, fn):
    def boom(*a, **k):
        raise RuntimeError("SECRET-LEDGER-456")

    monkeypatch.setattr(routes.ledger, fn, boom)
    with caplog.at_level(logging.DEBUG):
        r = post(client)
    assert r.status_code == 500
    assert r.json()["detail"] == "The analysis failed unexpectedly. Please try again."
    assert "SECRET-LEDGER-456" not in r.text
    assert "SECRET-LEDGER-456" not in caplog.text
