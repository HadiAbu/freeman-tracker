from dataclasses import dataclass, field

from app.analysis.schema import CasePoint, Confidence, LlmAnalysis, Stance
from app.news.models import NewsItem
from app.news.normalize import clean_text

MIN_ITEMS = 3
THIN_SUMMARY = "Not enough recent news to form a view."
MAX_POINTS = 5


@dataclass
class Grounded:
    stance: Stance
    confidence: Confidence
    summary: str
    case_for: list[CasePoint] = field(default_factory=list)
    case_against: list[CasePoint] = field(default_factory=list)
    watch_for: list[str] = field(default_factory=list)
    sources: list[NewsItem] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def thin_news(items: list[NewsItem], notes: list[str]) -> Grounded:
    return Grounded(stance="unclear", confidence="low", summary=THIN_SUMMARY, notes=list(notes))


def _supported(points: list[CasePoint], valid: set[str]) -> tuple[list[CasePoint], int]:
    kept: list[CasePoint] = []
    dropped = 0
    for p in points:
        ids = [i for i in dict.fromkeys(p.source_ids) if i in valid]  # unique, order kept
        text = clean_text(p.point, 400)
        if not ids or not text:
            dropped += 1
            continue
        kept.append(CasePoint(point=text, source_ids=ids))
    return kept[:MAX_POINTS], dropped


def ground(llm: LlmAnalysis, items: list[NewsItem], *, min_items: int = MIN_ITEMS) -> Grounded:
    """Keep only claims that cite headlines that were actually fetched; downgrade when unsupported."""
    if len(items) < min_items:
        return thin_news(items, [])

    notes: list[str] = []
    valid = {i.id for i in items}
    pro, dropped_pro = _supported(llm.case_for, valid)
    con, dropped_con = _supported(llm.case_against, valid)
    if dropped_pro + dropped_con:
        notes.append(f"{dropped_pro + dropped_con} point(s) dropped: they did not cite a fetched headline.")

    if not pro and not con:
        out = thin_news(items, notes)
        out.notes.append("No supported points remained, so no view is given.")
        return out

    stance, confidence = llm.stance, llm.confidence
    if not pro or not con:
        notes.append("One side of the case had no supported news, so the stance is unclear.")
        stance, confidence = "unclear", "low"

    by_id = {i.id: i for i in items}
    cited: list[NewsItem] = []
    for p in pro + con:
        for sid in p.source_ids:
            if by_id[sid] not in cited:
                cited.append(by_id[sid])

    return Grounded(
        stance=stance,
        confidence=confidence,
        summary=clean_text(llm.summary, 600),
        case_for=pro,
        case_against=con,
        watch_for=[w for w in (clean_text(x, 200) for x in llm.watch_for) if w][:MAX_POINTS],
        sources=cited,
        notes=notes,
    )
