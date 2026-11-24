from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.news.models import NewsItem
from app.news.normalize import canonical_url, clean_text, dedupe, item_id, select

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)


def mk(n, origin="finnhub_company", hours_ago=1, title=None):
    url = f"https://example.com/story-{n}"
    return NewsItem(
        id=item_id(url), title=title or f"Headline {n}", source="Wire",
        published_at=NOW - timedelta(hours=hours_ago), url=url, snippet="s", origin=origin,
    )


def ni(url="https://example.com/a", published_at=None):
    return NewsItem(
        id="abc", title="t", source="s", published_at=published_at,
        url=url, snippet="", origin="gdelt",
    )


def test_canonical_url_drops_tracking_fragment_and_trailing_slash():
    a = canonical_url("HTTPS://Example.com/path/?utm_source=x&id=7&fbclid=abc#frag")
    assert a == "https://example.com/path?id=7"


def test_canonical_url_rejects_non_http_schemes():
    assert canonical_url("javascript:alert(1)") == ""
    assert canonical_url("ftp://example.com/x") == ""
    assert canonical_url("not a url") == ""


def test_item_id_is_stable_across_tracking_variants():
    assert item_id("https://example.com/a?utm_campaign=1") == item_id("https://example.com/a/")
    assert item_id("https://example.com/a") != item_id("https://example.com/b")


def test_clean_text_strips_html_entities_control_chars_and_truncates():
    raw = "<p>Apple &amp; <b>Google</b>\x00 beat\n\n estimates</p>"
    assert clean_text(raw, 100) == "Apple & Google beat estimates"
    assert clean_text("x" * 50, 10) == "xxxxxxxxx…"
    assert clean_text(None, 10) == ""


def test_dedupe_by_id_and_by_normalized_title():
    a = mk(1, title="Apple Hits Record!")
    same_title = mk(2, title="apple hits record")
    same_id = NewsItem(**{**mk(1).model_dump(), "title": "Different"})
    out = dedupe([a, same_title, same_id, mk(3)])
    assert [i.title for i in out] == ["Apple Hits Record!", "Headline 3"]


def test_select_filters_age_caps_per_origin_orders_newest_first_and_totals():
    items = [mk(i, "finnhub_company", hours_ago=i) for i in range(1, 14)]  # 13 company items
    items += [mk(100 + i, "gdelt", hours_ago=i) for i in range(1, 12)]  # 11 gdelt items
    items.append(mk(999, "finnhub_company", hours_ago=24 * 9))  # too old
    out = select(items, now=NOW)
    assert all(i.id != item_id("https://example.com/story-999") for i in out)
    assert sum(i.origin == "finnhub_company" for i in out) == 10
    assert sum(i.origin == "gdelt" for i in out) == 8
    dates = [i.published_at for i in out]
    assert dates == sorted(dates, reverse=True)
    assert len(select(items, now=NOW, total=5)) == 5


# --- Fix round 1 ---

def test_dedupe_keeps_distinct_non_latin_titles():
    a = mk(1, title="أخبار الاقتصاد")
    b = mk(2, title="经济新闻")
    assert [i.title for i in dedupe([a, b])] == ["أخبار الاقتصاد", "经济新闻"]


def test_dedupe_keeps_distinct_cyrillic_titles():
    a = mk(1, title="Новости дня")
    b = mk(2, title="Курс рубля")
    assert len(dedupe([a, b])) == 2


def test_dedupe_collapses_identical_cyrillic_titles_case_insensitively():
    a = mk(1, title="Новости дня")
    b = mk(2, title="новости ДНЯ")
    assert len(dedupe([a, b])) == 1


def test_dedupe_keeps_distinct_all_punctuation_titles():
    a = mk(1, title="???")
    b = mk(2, title="!!!")
    assert len(dedupe([a, b])) == 2


def test_canonical_url_strips_credentials_and_default_ports():
    assert canonical_url("https://user:pass@Example.com:443/x") == "https://example.com/x"
    assert canonical_url("http://example.com:80/x") == "http://example.com/x"


def test_canonical_url_keeps_non_default_port():
    assert canonical_url("http://example.com:8080/x") == "http://example.com:8080/x"


def test_canonical_url_keeps_ipv6_brackets():
    assert canonical_url("http://[::1]:8080/x") == "http://[::1]:8080/x"


def test_canonical_url_rejects_empty_host_bad_host_and_bad_port():
    assert canonical_url("https://:80") == ""
    assert canonical_url("http://exa mple.com") == ""
    assert canonical_url("https://example.com:abc/") == ""


def test_item_id_ignores_credentials():
    assert item_id("https://user:pass@example.com/a") == item_id("https://example.com/a")


def test_clean_text_does_not_revive_escaped_markup():
    assert clean_text("&lt;script&gt;alert(1)&lt;/script&gt;", 100) == "alert(1)"


def test_clean_text_drops_unclosed_trailing_tag():
    assert clean_text("hello <img src=x", 100) == "hello"


def test_newsitem_rejects_empty_or_non_http_url():
    for bad in ("", "javascript:x"):
        with pytest.raises(ValidationError):
            ni(url=bad)


def test_newsitem_makes_naive_published_at_utc():
    it = ni(published_at=datetime(2026, 11, 17, 12, 0))
    assert it.published_at == datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)
    assert it.published_at.utcoffset() == timedelta(0)


def test_newsitem_converts_aware_published_at_to_utc():
    it = ni(published_at=datetime(2026, 11, 17, 14, 0, tzinfo=timezone(timedelta(hours=2))))
    assert it.published_at == datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)
    assert it.published_at.utcoffset() == timedelta(0)


def test_newsitem_keeps_none_published_at():
    assert ni(published_at=None).published_at is None
