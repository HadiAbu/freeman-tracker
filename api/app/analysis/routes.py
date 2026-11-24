import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app import ledger
from app.analysis import service, store
from app.analysis.llm import LlmClient, OpenAiLlm
from app.analysis.prompt import PositionInfo
from app.analysis.schema import _TICKER, Analysis, AnalysisRequest
from app.auth import require_api_key
from app.config import Settings, get_settings
from app.db import get_conn
from app.news.finnhub import FinnhubClient
from app.news.gdelt import GdeltClient
from app.news.service import NewsGatherer, gather_news

log = logging.getLogger(__name__)

router = APIRouter(prefix="/analysis", tags=["analysis"], dependencies=[Depends(require_api_key)])


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _require_config(settings: Settings) -> None:
    """503 naming every missing setting (names only, never values)."""
    missing = [
        name
        for name, value in (
            ("OPENAI_API_KEY", settings.openai_api_key),
            ("OPENAI_MODEL", settings.openai_model),
            ("FINNHUB_API_KEY", settings.finnhub_api_key),
        )
        if not value
    ]
    if missing:
        raise HTTPException(503, f"Analysis is not configured: set {', '.join(missing)} in freeman-api/.env.")


def get_news_gatherer(settings: Settings = Depends(get_settings)) -> NewsGatherer:
    _require_config(settings)
    finnhub = FinnhubClient(settings.finnhub_api_key, timeout=settings.news_timeout_seconds)
    gdelt = GdeltClient(timeout=settings.news_timeout_seconds)

    def gather(ticker: str, company_name: str | None):
        return gather_news(ticker, company_name=company_name, finnhub=finnhub, gdelt=gdelt, now=utcnow())

    return gather


def get_llm(settings: Settings = Depends(get_settings)) -> LlmClient:
    _require_config(settings)
    return OpenAiLlm(settings.openai_api_key, settings.openai_model, timeout=settings.llm_timeout_seconds)


@router.post("", response_model=Analysis)
def create_analysis(
    body: AnalysisRequest,
    conn=Depends(get_conn),
    settings: Settings = Depends(get_settings),
    news: NewsGatherer = Depends(get_news_gatherer),
    llm: LlmClient = Depends(get_llm),
):
    try:
        holding = ledger.holding_for(conn, body.ticker)
        position = (
            PositionInfo(holding.shares, holding.avg_cost, holding.price, holding.unrealized_pct)
            if holding is not None
            else None
        )
        company_name = (
            (holding.name if holding else None)
            or (ledger.meta(conn).get(body.ticker) or {}).get("name")
            or ledger.watchlist_name(conn, body.ticker)
        )
        deps = service.Deps(
            news=news, llm=llm, now=utcnow,
            cache_hours=settings.analysis_cache_hours,
            refresh_min_minutes=settings.analysis_refresh_min_minutes,
            daily_cap=settings.analysis_daily_cap,
        )
        return service.run_analysis(
            conn, ticker=body.ticker, refresh=body.refresh, personalize=body.personalize,
            position=position, company_name=company_name, deps=deps,
        )
    except service.AnalysisError as e:
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        raise HTTPException(e.status, str(e), headers=headers) from None
    except HTTPException:
        raise
    except Exception as e:
        # Fixed message, class name only: the exception text can carry prompt, position or keys.
        log.warning("analysis failed unexpectedly: %s", type(e).__name__)
        raise HTTPException(500, "The analysis failed unexpectedly. Please try again.") from None


@router.get("/{ticker}", response_model=Analysis)
def latest_analysis(ticker: str, conn=Depends(get_conn)):
    """The newest stored analysis for a ticker (even if stale). Never runs the pipeline."""
    t = ticker.strip().upper()
    if not _TICKER.match(t):
        raise HTTPException(422, "ticker must be 1-15 letters, digits, '.' or '-'")
    found = store.get_latest(conn, t)
    if found is None:
        raise HTTPException(404, "No analysis yet for this ticker.")
    return found
