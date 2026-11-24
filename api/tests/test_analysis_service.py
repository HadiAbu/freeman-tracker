from datetime import datetime, timedelta, timezone

import pytest

from app.analysis import service, store
from app.analysis.llm import LlmBadOutput, LlmUnavailable
from app.analysis.prompt import PositionInfo
from app.analysis.schema import CasePoint, LlmAnalysis
from app.news.models import NewsItem
from app.news.normalize import item_id
from app.news.service import NewsBundle

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)


def mk(n):
    url = f"https://example.com/{n}"
    return NewsItem(id=item_id(url), title=f"T{n}", source="Wire", published_at=NOW, url=url, snippet="", origin="finnhub_company")


ITEMS = [mk(i) for i in range(1, 6)]


class FakeLlm:
    model = "fake-model"

    def __init__(self, result=None, error=None):
        self.result, self.error, self.inputs = result, error, []

    def analyze(self, instructions, input_text):
        self.inputs.append(input_text)
        if self.error:
            raise self.error
        return self.result


def good(stance="hold"):
    return LlmAnalysis(stance=stance, confidence="medium", summary="Because.",
                       case_for=[CasePoint(point="Up", source_ids=[ITEMS[0].id])],
                       case_against=[CasePoint(point="Down", source_ids=[ITEMS[1].id])], watch_for=["Earnings"])


class Clock:
    def __init__(self):
        self.t = NOW

    def __call__(self):
        return self.t


def deps(llm, items=ITEMS, ok=True, notes=None, clock=None, cap=30, refresh_min=15):
    calls = {"news": 0}

    def news(ticker, name):
        calls["news"] += 1
        return NewsBundle(items=list(items), notes=list(notes or []), company_name=name, any_source_ok=ok)

    d = service.Deps(news=news, llm=llm, now=clock or Clock(), cache_hours=6, refresh_min_minutes=refresh_min, daily_cap=cap)
    return d, calls


def run(conn, d, *, refresh=False, personalize=True, position=None, ticker="AAPL"):
    return service.run_analysis(conn, ticker=ticker, refresh=refresh, personalize=personalize,
                                position=position, company_name="Apple Inc", deps=d)


POS = PositionInfo(10, 100.0, 120.0, 20.0)


@pytest.fixture(autouse=True)
def _reset_failed():
    service.reset_failed_attempts()
    yield
    service.reset_failed_attempts()


def test_happy_path_returns_a_grounded_analysis_and_caches_it(db_conn):
    llm = FakeLlm(good())
    d, calls = deps(llm)
    a = run(db_conn, d)
    assert a.stance == "hold" and a.cached is False and a.model == "fake-model" and a.personalized is False
    assert {s.id for s in a.sources} == {ITEMS[0].id, ITEMS[1].id}
    again = run(db_conn, d)
    assert again.cached is True and len(llm.inputs) == 1 and calls["news"] == 1


def test_personalization_follows_the_flag_and_the_presence_of_a_position(db_conn):
    llm = FakeLlm(good())
    d, _ = deps(llm)
    a = run(db_conn, d, position=POS, personalize=True)
    assert a.personalized is True and '"shares": 10' in llm.inputs[0]
    off = run(db_conn, d, position=POS, personalize=False)
    assert off.personalized is False and '"position": null' in llm.inputs[1]
    none = run(db_conn, d, position=None, personalize=True, ticker="MSFT")
    assert none.personalized is False


def test_changing_the_position_invalidates_the_cache(db_conn):
    llm = FakeLlm(good())
    d, _ = deps(llm)
    run(db_conn, d, position=POS)
    run(db_conn, d, position=PositionInfo(11, 100.0, 120.0, 20.0))
    assert len(llm.inputs) == 2


def test_refresh_too_soon_raises_with_retry_after_then_is_allowed_later(db_conn):
    clock = Clock()
    d, _ = deps(FakeLlm(good()), clock=clock)
    run(db_conn, d)
    clock.t = NOW + timedelta(minutes=5)
    with pytest.raises(service.RefreshTooSoon) as exc:
        run(db_conn, d, refresh=True)
    assert exc.value.status == 429 and exc.value.retry_after == 600
    clock.t = NOW + timedelta(minutes=16)
    assert run(db_conn, d, refresh=True).cached is False


def test_daily_cap_blocks_new_runs_but_not_cache_hits(db_conn):
    d, _ = deps(FakeLlm(good()), cap=1)
    run(db_conn, d)
    assert run(db_conn, d).cached is True  # a hit costs nothing
    with pytest.raises(service.DailyCapReached) as exc:
        run(db_conn, d, ticker="MSFT")
    assert exc.value.status == 429 and exc.value.retry_after == 12 * 3600


def test_thin_news_returns_unclear_without_calling_the_model(db_conn):
    llm = FakeLlm(good())
    d, calls = deps(llm, items=ITEMS[:2], notes=["GDELT unavailable"])
    a = run(db_conn, d)
    assert a.stance == "unclear" and llm.inputs == [] and "GDELT unavailable" in a.notes
    assert a.cached is False and a.model == "none"
    assert store.get_latest(db_conn, "AAPL") is None
    assert store.count_since(db_conn, store.start_of_utc_day(NOW)) == 0
    run(db_conn, d)
    assert calls["news"] == 2 and llm.inputs == []


def test_all_news_sources_failing_is_a_502_style_error(db_conn):
    d, _ = deps(FakeLlm(good()), items=[], ok=False)
    with pytest.raises(service.NewsUnavailable) as exc:
        run(db_conn, d)
    assert exc.value.status == 502


@pytest.mark.parametrize("error", [LlmUnavailable("OpenAI rate limit or quota reached."), LlmBadOutput("bad")])
def test_model_failures_become_llm_failed_with_the_safe_message(db_conn, error):
    d, _ = deps(FakeLlm(error=error))
    with pytest.raises(service.LlmFailed) as exc:
        run(db_conn, d)
    assert exc.value.status == 502 and str(error) in str(exc.value)


def test_grounding_notes_and_news_notes_are_both_reported(db_conn):
    bad = LlmAnalysis(stance="hold", confidence="low", summary="s",
                      case_for=[CasePoint(point="Fake", source_ids=["nope"])],
                      case_against=[CasePoint(point="Real", source_ids=[ITEMS[0].id])], watch_for=[])
    d, _ = deps(FakeLlm(bad), notes=["GDELT world news unavailable (rate limited)."])
    a = run(db_conn, d)
    assert any("GDELT" in n for n in a.notes) and any("dropped" in n.lower() for n in a.notes)


def test_failed_model_calls_count_toward_the_daily_cap(db_conn):
    ok_d, _ = deps(FakeLlm(good()), cap=2)
    run(db_conn, ok_d, ticker="MSFT")  # one saved analysis, cached
    d, _ = deps(FakeLlm(error=LlmBadOutput("bad")), cap=3)
    for t in ("A1", "A2"):
        with pytest.raises(service.LlmFailed):
            run(db_conn, d, ticker=t)
    with pytest.raises(service.DailyCapReached):
        run(db_conn, d, ticker="A3")
    assert run(db_conn, d, ticker="MSFT").cached is True


def test_two_failures_with_cap_two_block_the_third_new_run(db_conn):
    d, _ = deps(FakeLlm(error=LlmBadOutput("bad")), cap=2)
    for t in ("A1", "A2"):
        with pytest.raises(service.LlmFailed):
            run(db_conn, d, ticker=t)
    with pytest.raises(service.DailyCapReached):
        run(db_conn, d, ticker="A3")


def test_failures_do_not_carry_over_to_the_next_utc_day(db_conn):
    clock = Clock()
    d, _ = deps(FakeLlm(error=LlmBadOutput("bad")), cap=1, clock=clock)
    with pytest.raises(service.LlmFailed):
        run(db_conn, d)
    with pytest.raises(service.DailyCapReached):
        run(db_conn, d)
    clock.t = NOW + timedelta(days=1)
    with pytest.raises(service.LlmFailed):
        run(db_conn, d)


def test_successful_runs_do_not_touch_the_failure_counter(db_conn):
    d, _ = deps(FakeLlm(good()), cap=5)
    run(db_conn, d)
    assert service._failed_attempts == {}


def test_news_unavailable_does_not_count_as_a_failed_attempt(db_conn):
    d, _ = deps(FakeLlm(good()), items=[], ok=False)
    with pytest.raises(service.NewsUnavailable):
        run(db_conn, d)
    assert service._failed_attempts == {}
