import pytest
from pydantic import ValidationError

from app.analysis.grounding import MIN_ITEMS, THIN_SUMMARY, ground, thin_news
from app.analysis.schema import AnalysisRequest, CasePoint, LlmAnalysis
from app.news.models import NewsItem
from app.news.normalize import item_id


def item(n):
    url = f"https://example.com/{n}"
    return NewsItem(id=item_id(url), title=f"T{n}", source="Wire", published_at=None, url=url,
                    snippet="", origin="finnhub_company")


ITEMS = [item(i) for i in range(1, 6)]
IDS = [i.id for i in ITEMS]


def llm(stance="hold", conf="medium", pro=None, con=None, watch=None, summary="A summary."):
    return LlmAnalysis(
        stance=stance, confidence=conf, summary=summary,
        case_for=pro if pro is not None else [CasePoint(point="Good", source_ids=[IDS[0]])],
        case_against=con if con is not None else [CasePoint(point="Bad", source_ids=[IDS[1]])],
        watch_for=watch or ["Earnings"],
    )


def test_a_well_grounded_answer_passes_through_with_cited_sources_in_order():
    out = ground(llm(pro=[CasePoint(point="Good", source_ids=[IDS[2]])]), ITEMS)
    assert out.stance == "hold" and out.confidence == "medium" and out.notes == []
    assert [s.id for s in out.sources] == [IDS[2], IDS[1]]  # first-citation order, only cited ones


def test_unknown_source_ids_are_dropped_and_points_without_support_removed():
    pro = [CasePoint(point="Made up", source_ids=["nope"]), CasePoint(point="Real", source_ids=["nope", IDS[0]])]
    out = ground(llm(pro=pro), ITEMS)
    assert [p.point for p in out.case_for] == ["Real"]
    assert out.case_for[0].source_ids == [IDS[0]]
    assert any("dropped" in n.lower() for n in out.notes)


def test_points_with_no_citations_are_dropped():
    out = ground(llm(pro=[CasePoint(point="Uncited", source_ids=[])]), ITEMS)
    assert out.stance == "unclear" and out.confidence == "low"  # one side lost all support
    assert out.case_for == []
    assert [p.point for p in out.case_against] == ["Bad"]


def test_buy_without_any_case_for_downgrades_to_unclear():
    out = ground(llm(stance="buy", pro=[CasePoint(point="x", source_ids=["nope"])]), ITEMS)
    assert out.stance == "unclear" and out.confidence == "low"
    assert any("unclear" in n.lower() for n in out.notes)


def test_sell_without_any_case_against_downgrades_to_unclear():
    out = ground(llm(stance="sell", con=[]), ITEMS)
    assert out.stance == "unclear"


def test_buy_with_empty_case_against_downgrades_to_unclear():
    out = ground(llm(stance="buy", con=[]), ITEMS)
    assert out.stance == "unclear" and out.confidence == "low"
    assert [p.point for p in out.case_for] == ["Good"]
    assert any("unclear" in n.lower() for n in out.notes)


def test_sell_with_empty_case_for_downgrades_to_unclear():
    out = ground(llm(stance="sell", pro=[]), ITEMS)
    assert out.stance == "unclear" and out.confidence == "low"
    assert [p.point for p in out.case_against] == ["Bad"]
    assert any("unclear" in n.lower() for n in out.notes)


def test_hold_with_both_sides_supported_keeps_stance_and_confidence():
    out = ground(llm(stance="hold", conf="high"), ITEMS)
    assert out.stance == "hold" and out.confidence == "high"
    assert [p.point for p in out.case_for] == ["Good"]
    assert [p.point for p in out.case_against] == ["Bad"]


def test_no_supported_points_at_all_is_unclear_with_a_plain_summary():
    out = ground(llm(pro=[], con=[]), ITEMS)
    assert out.stance == "unclear" and out.summary == THIN_SUMMARY and out.sources == []


def test_thin_news_skips_the_model_result_entirely():
    out = ground(llm(stance="buy"), ITEMS[: MIN_ITEMS - 1])
    assert out.stance == "unclear" and out.case_for == [] and out.case_against == []


def test_thin_news_helper_builds_an_unclear_result_with_notes():
    out = thin_news([], ["GDELT unavailable"])
    assert out.stance == "unclear" and out.confidence == "low" and out.summary == THIN_SUMMARY
    assert "GDELT unavailable" in out.notes


def test_text_is_cleaned_capped_and_html_removed():
    pro = [CasePoint(point="<b>Strong</b> " + "x" * 600, source_ids=[IDS[0]])]
    out = ground(llm(pro=pro, watch=["<i>Earnings</i>"] + [f"w{i}" for i in range(9)], summary="<p>Hi</p>"), ITEMS)
    assert out.case_for[0].point.startswith("Strong ") and len(out.case_for[0].point) <= 400
    assert out.watch_for[0] == "Earnings" and len(out.watch_for) == 5
    assert out.summary == "Hi"


def test_at_most_five_points_per_side():
    pro = [CasePoint(point=f"p{i}", source_ids=[IDS[0]]) for i in range(9)]
    assert len(ground(llm(pro=pro), ITEMS).case_for) == 5


def test_request_ticker_is_normalized_and_validated():
    assert AnalysisRequest(ticker=" aapl ").ticker == "AAPL"
    assert AnalysisRequest(ticker="brk.b").personalize is True
    for bad in ("", "A B", "x" * 20, "AAPL;DROP"):
        with pytest.raises(ValidationError):
            AnalysisRequest(ticker=bad)
