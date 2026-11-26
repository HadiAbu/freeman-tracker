import threading
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Callable

from app.analysis import store
from app.analysis.grounding import MIN_ITEMS, ground, thin_news
from app.analysis.llm import LlmClient, LlmError
from app.analysis.prompt import PositionInfo, build_prompt
from app.analysis.schema import Analysis, SourceOut
from app.news.service import NewsGatherer

# One analysis at a time: a duplicate concurrent request then finds the first one's cache entry,
# and two requests cannot spend the same slot of the daily budget.
_pipeline_lock = threading.Lock()

# Failed model calls save nothing but still cost tokens, so they count toward the daily cap.
# In-process, keyed by UTC date, only ever touched inside _pipeline_lock.
# (user, UTC day) -> failed model calls. Per user, so one account's failures never use up another's cap.
_failed_attempts: dict[tuple[int, date], int] = {}


def reset_failed_attempts() -> None:
    """Clear the failed-attempt counter (tests only)."""
    _failed_attempts.clear()


class AnalysisError(Exception):
    status = 500
    retry_after: int | None = None


class RefreshTooSoon(AnalysisError):
    status = 429

    def __init__(self, retry_after: int):
        super().__init__(f"Refreshed recently. Try again in {max(1, retry_after // 60)} minute(s).")
        self.retry_after = retry_after


class DailyCapReached(AnalysisError):
    status = 429

    def __init__(self, retry_after: int):
        super().__init__("The daily limit for new analyses has been reached.")
        self.retry_after = retry_after


class NewsUnavailable(AnalysisError):
    status = 502

    def __init__(self):
        super().__init__("No news source could be reached. Try again in a few minutes.")


class LlmFailed(AnalysisError):
    status = 502


@dataclass
class Deps:
    news: NewsGatherer
    llm: LlmClient
    now: Callable[[], datetime]
    cache_hours: int
    refresh_min_minutes: int
    daily_cap: int


def run_analysis(
    conn,
    *,
    user_id: int,
    ticker: str,
    refresh: bool,
    personalize: bool,
    position: PositionInfo | None,
    company_name: str | None,
    deps: Deps,
) -> Analysis:
    personalized = bool(personalize and position is not None)
    pos = position if personalized else None
    ph = store.position_hash(pos)

    with _pipeline_lock:
        now = deps.now()
        if not refresh:
            fresh = store.get_fresh(conn, user_id, ticker, ph, personalized, now)
            if fresh is not None:
                return fresh
        else:
            wait = store.refresh_wait_seconds(
                store.last_created(conn, user_id, ticker, ph, personalized), now, deps.refresh_min_minutes
            )
            if wait > 0:
                raise RefreshTooSoon(wait)

        today = now.date()
        for k in [k for k in _failed_attempts if k[1] != today]:
            del _failed_attempts[k]
        failed_today = _failed_attempts.get((user_id, today), 0)
        if store.count_since(conn, user_id, store.start_of_utc_day(now)) + failed_today >= deps.daily_cap:
            raise DailyCapReached(store.seconds_until_next_utc_day(now))

        bundle = deps.news(ticker, company_name)
        if not bundle.items and not bundle.any_source_ok:
            raise NewsUnavailable()

        if len(bundle.items) < MIN_ITEMS:
            grounded = thin_news(bundle.items, bundle.notes)
            # No model ran: return without persisting, so it is neither cached nor charged to the cap.
            return Analysis(
                ticker=ticker, generated_at=now, cached=False, personalized=personalized,
                stance=grounded.stance, confidence=grounded.confidence, summary=grounded.summary,
                case_for=grounded.case_for, case_against=grounded.case_against, watch_for=grounded.watch_for,
                sources=[SourceOut(**s.model_dump(exclude={"snippet"})) for s in grounded.sources],
                notes=grounded.notes, model="none",
            )
        else:
            instructions, input_text = build_prompt(
                ticker=ticker, company_name=bundle.company_name or company_name,
                items=bundle.items, position=pos, today=now.date(),
            )
            try:
                llm_out = deps.llm.analyze(instructions, input_text)
            except LlmError as e:
                _failed_attempts[(user_id, today)] = _failed_attempts.get((user_id, today), 0) + 1
                raise LlmFailed(str(e)) from None
            grounded = ground(llm_out, bundle.items)
            grounded.notes = list(bundle.notes) + grounded.notes

        analysis = Analysis(
            ticker=ticker, generated_at=now, cached=False, personalized=personalized,
            stance=grounded.stance, confidence=grounded.confidence, summary=grounded.summary,
            case_for=grounded.case_for, case_against=grounded.case_against, watch_for=grounded.watch_for,
            sources=[SourceOut(**s.model_dump(exclude={"snippet"})) for s in grounded.sources],
            notes=grounded.notes, model=deps.llm.model,
        )
        store.save(conn, user_id, analysis, ph=ph, personalized=personalized,
                   expires_at=now + timedelta(hours=deps.cache_hours))
        return analysis
