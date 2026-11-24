from datetime import datetime, timedelta, timezone

import pytest

from app.news.models import NewsItem, NewsSourceError
from app.news.normalize import item_id
from app.news.service import build_gdelt_query, gather_news

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)


def mk(n, origin, hours_ago=1):
    url = f"https://example.com/{origin}-{n}"
    return NewsItem(id=item_id(url), title=f"{origin} headline {n}", source="Wire",
                    published_at=NOW - timedelta(hours=hours_ago), url=url, snippet="", origin=origin)


class FakeFinnhub:
    def __init__(self, company=(), market=(), name="Apple Inc", fail=()):
        self.company, self.market, self.name, self.fail = list(company), list(market), name, set(fail)

    def profile(self, symbol):
        if "profile" in self.fail:
            raise NewsSourceError("finnhub", "HTTP 500")
        return {"name": self.name, "industry": "Tech"}

    def company_news(self, symbol, today):
        if "company" in self.fail:
            raise NewsSourceError("finnhub", "HTTP 429")
        return self.company

    def market_news(self):
        if "market" in self.fail:
            raise NewsSourceError("finnhub", "HTTP 500")
        return self.market


class FakeGdelt:
    def __init__(self, items=(), fail=False):
        self.items, self.fail, self.queries = list(items), fail, []

    def articles(self, query, **kw):
        self.queries.append(query)
        if self.fail:
            raise NewsSourceError("gdelt", "rate limited")
        return self.items


def run(fin, gd, name=None):
    return gather_news("AAPL", company_name=name, finnhub=fin, gdelt=gd, now=NOW)


def test_build_gdelt_query_quotes_the_name_and_strips_quote_characters():
    assert build_gdelt_query("Apple Inc") == '"Apple Inc" sourcelang:english'
    assert build_gdelt_query('Bad "Name"\\') =='"Bad Name" sourcelang:english'  # quotes/backslash removed
    assert build_gdelt_query(None) is None and build_gdelt_query("  ") is None


def test_gathers_all_sources_and_uses_the_known_company_name():
    fin = FakeFinnhub(company=[mk(1, "finnhub_company")], market=[mk(2, "finnhub_market")])
    gd = FakeGdelt([mk(3, "gdelt")])
    bundle = run(fin, gd, name="Apple Inc.")
    assert {i.origin for i in bundle.items} == {"finnhub_company", "finnhub_market", "gdelt"}
    assert bundle.company_name == "Apple Inc." and bundle.any_source_ok and bundle.notes == []
    assert gd.queries == ['"Apple Inc." sourcelang:english']


def test_company_name_falls_back_to_the_finnhub_profile():
    gd = FakeGdelt()
    bundle = run(FakeFinnhub(name="Profile Name"), gd, name=None)
    assert bundle.company_name == "Profile Name" and gd.queries == ['"Profile Name" sourcelang:english']


def test_one_failing_source_degrades_and_is_noted():
    fin = FakeFinnhub(company=[mk(1, "finnhub_company")], market=[mk(2, "finnhub_market")])
    bundle = run(fin, FakeGdelt(fail=True), name="Apple")
    assert len(bundle.items) == 2 and bundle.any_source_ok
    assert any("GDELT" in n for n in bundle.notes)


def test_gdelt_is_skipped_with_a_note_when_the_company_name_is_unknown():
    gd = FakeGdelt([mk(1, "gdelt")])
    bundle = run(FakeFinnhub(name=None, fail=()), gd, name=None)
    assert gd.queries == [] and any("company name" in n for n in bundle.notes)


def test_everything_failing_reports_no_source_ok():
    fin = FakeFinnhub(fail={"profile", "company", "market"})
    bundle = run(fin, FakeGdelt(fail=True), name=None)
    assert bundle.items == [] and bundle.any_source_ok is False
    assert len(bundle.notes) >= 3


def test_duplicates_across_sources_are_removed():
    same = mk(1, "finnhub_company")
    dup = same.model_copy(update={"origin": "finnhub_market"})
    bundle = run(FakeFinnhub(company=[same], market=[dup]), FakeGdelt(), name="Apple")
    assert len(bundle.items) == 1


def test_provider_note_carries_only_the_reason_not_extra_detail_or_cause():
    class LeakyFinnhub(FakeFinnhub):
        def company_news(self, symbol, today):
            e = NewsSourceError("finnhub", "HTTP 429")
            e.detail = "SECRET-TOKEN-123"
            raise e from ValueError("SECRET-TOKEN-123")

    bundle = run(LeakyFinnhub(market=[mk(2, "finnhub_market")]), FakeGdelt(), name="Apple")
    assert "Finnhub company news unavailable (HTTP 429)." in bundle.notes
    assert not any("SECRET-TOKEN-123" in n for n in bundle.notes)
    assert [i.origin for i in bundle.items] == ["finnhub_market"]


def _raiser(exc):
    def fail(*args, **kwargs):
        raise exc
    return fail


UNEXPECTED_NOTES = {
    "profile": "Company profile unavailable (unexpected error).",
    "company": "Finnhub company news unavailable (unexpected error).",
    "market": "Finnhub market news unavailable (unexpected error).",
    "gdelt": "GDELT world news unavailable (unexpected error).",
}


@pytest.mark.parametrize("exc", [ValueError("SECRET-TOKEN-123"), KeyError("SECRET-TOKEN-123"), TypeError("SECRET-TOKEN-123")])
@pytest.mark.parametrize("failing", list(UNEXPECTED_NOTES))
def test_unexpected_errors_degrade_with_a_generic_note(failing, exc, caplog):
    fin = FakeFinnhub(company=[mk(1, "finnhub_company")], market=[mk(2, "finnhub_market")])
    gd = FakeGdelt([mk(3, "gdelt")])
    name = None if failing == "profile" else "Apple"
    if failing == "profile":
        fin.profile = _raiser(exc)
    elif failing == "company":
        fin.company_news = _raiser(exc)
    elif failing == "market":
        fin.market_news = _raiser(exc)
    else:
        gd.articles = _raiser(exc)

    with caplog.at_level("WARNING"):
        bundle = run(fin, gd, name=name)

    assert UNEXPECTED_NOTES[failing] in bundle.notes
    assert not any("SECRET-TOKEN-123" in n for n in bundle.notes)
    assert "SECRET-TOKEN-123" not in caplog.text
    assert bundle.any_source_ok
    surviving = {"profile": {"finnhub_company", "finnhub_market"}, "company": {"finnhub_market", "gdelt"},
                 "market": {"finnhub_company", "gdelt"}, "gdelt": {"finnhub_company", "finnhub_market"}}
    assert {i.origin for i in bundle.items} == surviving[failing]


@pytest.mark.parametrize("profile", [{"name": 123}, {"name": ["x"]}, {"name": "   "}, "not a dict"])
def test_unusable_profile_name_skips_gdelt_without_raising(profile):
    class OddProfile(FakeFinnhub):
        def profile(self, symbol):
            return profile

    gd = FakeGdelt([mk(1, "gdelt")])
    bundle = run(OddProfile(), gd, name=None)
    assert gd.queries == [] and any("company name" in n for n in bundle.notes)
    assert bundle.company_name is None


def test_company_name_is_stripped_and_non_string_query_input_is_rejected():
    gd = FakeGdelt()
    bundle = run(FakeFinnhub(), gd, name="  Apple Inc.  ")
    assert bundle.company_name == "Apple Inc." and gd.queries == ['"Apple Inc." sourcelang:english']
    assert build_gdelt_query(123) is None
