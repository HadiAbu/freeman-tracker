import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from app.news.models import NewsItem, NewsSourceError
from app.news.normalize import dedupe, select

log = logging.getLogger(__name__)


@dataclass
class NewsBundle:
    items: list[NewsItem]
    notes: list[str] = field(default_factory=list)
    company_name: str | None = None
    any_source_ok: bool = False


# (ticker, known company name or None) -> bundle. The route injects a real one; tests inject fakes.
NewsGatherer = Callable[[str, "str | None"], NewsBundle]


def _clean_name(value) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _unexpected(notes: list[str], what: str, e: Exception) -> None:
    # Class name only: the message may carry tokens or URLs.
    notes.append(f"{what} unavailable (unexpected error).")
    log.warning("news source failed: %s", type(e).__name__)


def build_gdelt_query(name: str | None) -> str | None:
    if not isinstance(name, str):
        return None
    cleaned = re.sub(r'["\\]', " ", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return f'"{cleaned}" sourcelang:english' if cleaned else None


def gather_news(ticker: str, *, company_name: str | None, finnhub, gdelt, now: datetime) -> NewsBundle:
    """Fetch every source; a failing source degrades the result instead of failing it."""
    notes: list[str] = []
    items: list[NewsItem] = []
    ok = False

    name = _clean_name(company_name)
    if not name:
        try:
            profile = finnhub.profile(ticker)
            name = _clean_name(profile.get("name")) if isinstance(profile, dict) else None
        except NewsSourceError as e:
            notes.append(f"Company profile unavailable ({e.reason}).")
        except Exception as e:
            _unexpected(notes, "Company profile", e)

    try:
        items += finnhub.company_news(ticker, now.date())
        ok = True
    except NewsSourceError as e:
        notes.append(f"Finnhub company news unavailable ({e.reason}).")
    except Exception as e:
        _unexpected(notes, "Finnhub company news", e)

    try:
        items += finnhub.market_news()
        ok = True
    except NewsSourceError as e:
        notes.append(f"Finnhub market news unavailable ({e.reason}).")
    except Exception as e:
        _unexpected(notes, "Finnhub market news", e)

    query = build_gdelt_query(name)
    if query is None:
        notes.append("GDELT world news skipped: company name unknown.")
    else:
        try:
            items += gdelt.articles(query)
            ok = True
        except NewsSourceError as e:
            notes.append(f"GDELT world news unavailable ({e.reason}).")
        except Exception as e:
            _unexpected(notes, "GDELT world news", e)

    return NewsBundle(
        items=select(dedupe(items), now=now), notes=notes, company_name=name, any_source_ok=ok
    )
