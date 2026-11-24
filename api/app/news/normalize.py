import hashlib
import html
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.news.models import NewsItem

_TRACKING = re.compile(r"^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src)$", re.I)
_TAG = re.compile(r"<[^>]*>")
_OPEN_FRAGMENT = re.compile(r"<[A-Za-z/!][^>]*$")
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_EPOCH = datetime.min.replace(tzinfo=timezone.utc)
_DEFAULT_PORTS = {"http": 80, "https": 443}

DEFAULT_CAPS = {"finnhub_company": 10, "finnhub_market": 5, "gdelt": 8}


def canonical_url(url: str) -> str:
    """Normalized http(s) URL, or "" when the input is not a safe web URL.

    Userinfo is dropped, default ports are dropped, the host is lowercased and
    IPv6 literals keep their brackets. Fragment and tracking params are removed.
    """
    try:
        parts = urlsplit((url or "").strip())
        scheme = parts.scheme.lower()
        host = parts.hostname
        port = parts.port
    except ValueError:
        return ""
    if scheme not in _DEFAULT_PORTS or not host or any(c.isspace() for c in host):
        return ""
    netloc = f"[{host}]" if ":" in host else host
    if port is not None and port != _DEFAULT_PORTS[scheme]:
        netloc = f"{netloc}:{port}"
    query = urlencode(
        [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _TRACKING.match(k)]
    )
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((scheme, netloc, path, query, ""))


def item_id(url: str) -> str:
    return hashlib.sha1(canonical_url(url).encode("utf-8")).hexdigest()[:10]


def clean_text(text: str | None, limit: int) -> str:
    """Plain text: tags stripped, entities decoded, markup re-stripped, control chars and runs of space removed."""
    text = _TAG.sub(" ", text or "")
    text = html.unescape(text)
    text = _TAG.sub(" ", text)
    text = _OPEN_FRAGMENT.sub(" ", text)
    text = _CTRL.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _title_key(title: str) -> str:
    return re.sub(r"\W+", "", title.casefold())


def dedupe(items: list[NewsItem]) -> list[NewsItem]:
    seen_ids: set[str] = set()
    seen_titles: set[str] = set()
    out: list[NewsItem] = []
    for it in items:
        key = _title_key(it.title)
        if it.id in seen_ids or (key and key in seen_titles):
            continue
        seen_ids.add(it.id)
        if key:
            seen_titles.add(key)
        out.append(it)
    return out


def select(
    items: list[NewsItem],
    *,
    now: datetime,
    max_age_days: int = 7,
    caps: dict[str, int] | None = None,
    total: int = 20,
) -> list[NewsItem]:
    """Newest first, within the age window, capped per origin and overall."""
    caps = caps or DEFAULT_CAPS
    cutoff = now - timedelta(days=max_age_days)
    fresh = [i for i in items if i.published_at is None or i.published_at >= cutoff]
    fresh.sort(key=lambda i: i.published_at or _EPOCH, reverse=True)
    counts: dict[str, int] = {}
    out: list[NewsItem] = []
    for it in fresh:
        if counts.get(it.origin, 0) >= caps.get(it.origin, 0):
            continue
        counts[it.origin] = counts.get(it.origin, 0) + 1
        out.append(it)
        if len(out) >= total:
            break
    return out
