# News-based stock analysis: design

Status: draft for review. Date: 2026-11-17. Classification: architectural (new server pipeline, two
external data sources, an LLM provider, one new screen).

## 1. Summary

The user picks a stock and sees a short, sourced case for why it might be a good idea to **buy, hold or
sell**, based on recent news: company news, market news, and global events. A server pipeline fetches
the news, asks an LLM to reason over it, validates the answer, caches it, and returns a structured
result that the app renders with its citations.

The result is presented as **one opinion with its evidence**, never as an instruction. It is
informational and is not financial advice.

## 2. Goals and non-goals

Goals
- From a ticker (any ticker, not only holdings), produce a lean (Buy / Hold / Sell / Unclear), a
  confidence level, a case for, a case against, what would change the view, and the sources.
- When the user holds the ticker, take the position into account (shares, average cost, gain/loss), so
  the question is "hold or sell?" and not just "is it a good company?".
- Every claim is traceable to a headline the server actually fetched.
- Keep all API keys on the server. Control cost with caching and caps.

Non-goals (out of scope for this feature)
- Price forecasts, valuation models, backtesting, or any trading action.
- Push notifications or scheduled/automatic analyses.
- Multi-user accounts or per-user quotas (single user for now).
- News sentiment scoring as a separate feature, streaming responses, or an async job queue
  (approach B in the brainstorm; can be added later without redesign).
- Live market prices (still manual).

## 3. Decisions made in brainstorming

| Decision | Choice |
|---|---|
| Who writes the reasoning | OpenAI model, called from the server only. User has a key. |
| News sources | Finnhub (company news and general market news) plus GDELT (global events). |
| Scope | Any ticker; personalized with the user's position when the ticker is held. |
| Architecture | Server pipeline, on demand, cached (approach A). |
| Framing | A "lean" with confidence and both sides, plus a persistent not-financial-advice note. |
| Order of work | This feature first (phase 7), then test suites (phase 8), then security audit. |

## 4. Architecture and data flow

```
App (Expo) --POST /analysis {ticker}--> freeman-api
                                          |-- read position (trades, latest price, holding meta)
                                          |-- cache lookup (ticker + position hash) -> hit: return
                                          |-- fetch news: Finnhub company + market, GDELT global
                                          |-- normalize, de-duplicate, select <= 20 items
                                          |-- build prompt (headlines = untrusted data)
                                          |-- OpenAI call with a JSON schema
                                          |-- validate schema + grounding (citations are real)
                                          |-- store in Turso, return Analysis
```

Keys (`OPENAI_API_KEY`, `FINNHUB_API_KEY`) exist only in `freeman-api/.env`. The app never calls OpenAI,
Finnhub or GDELT. It talks to freeman-api with the existing `X-API-Key`.

## 5. API contract

`POST /analysis` body `{ "ticker": "AAPL", "refresh": false, "personalize": true }`
- `personalize` (default true) only has an effect for a held ticker; for any other ticker it is ignored
  and the result has `personalized: false`.
- Returns the cached analysis if one exists for (ticker, position hash, personalized) and is younger
  than the cache window; otherwise runs the pipeline. `refresh: true` bypasses the cache but respects
  the minimum refresh interval.
- 200 `Analysis` (section 6). 422 invalid ticker (request validation). 429 daily cap or refresh too soon (with `retry_after`
  seconds). 502 upstream failed with nothing usable. 503 a required key is not configured.
- Thin or empty news is **not** an error: it returns 200 with `stance: "unclear"`.

`GET /analysis/{ticker}` returns the latest cached analysis for that ticker, or 404. It never calls the
pipeline, so the app can show a previous result instantly and offer Refresh.

All routes require the existing `X-API-Key` (same auth, same fail-closed behavior).

## 6. The Analysis object

```json
{
  "ticker": "AAPL",
  "generated_at": "2026-11-17T09:30:00Z",
  "cached": false,
  "personalized": true,
  "stance": "hold",
  "confidence": "medium",
  "summary": "Two or three sentences.",
  "case_for": [ { "point": "text", "source_ids": ["a1b2c3"] } ],
  "case_against": [ { "point": "text", "source_ids": ["d4e5f6"] } ],
  "watch_for": [ "what would change this view" ],
  "sources": [
    { "id": "a1b2c3", "title": "", "source": "Reuters", "published_at": "", "url": "", "origin": "finnhub_company" }
  ],
  "notes": [ "GDELT unavailable; used Finnhub only." ],
  "model": "configured model name"
}
```

- `stance`: `buy | hold | sell | unclear`. `confidence`: `low | medium | high`.
- `personalized` is true only when the user holds the ticker and the position was sent to the model.
- `notes` records degradations (a source was down, news was thin, a claim was dropped).

## 7. News layer

Each item is normalized to `NewsItem { id, title, source, published_at, url, snippet, origin }`:
- `id` is a short hash of the canonical URL, stable across fetches.
- `snippet` is plain text, HTML stripped, truncated to about 300 characters.
- `origin` is `finnhub_company`, `finnhub_market` or `gdelt`.

Selection: the last 7 days; at most about 10 company items, 5 market items and 8 GDELT items; near
duplicate titles removed; newest and most relevant first; about 20 items in total. The company name and
industry used for the GDELT query come from the holding or watchlist name, or from Finnhub's company
profile when neither exists. Each source is fetched with its own short timeout, and one failing source
degrades the result (noted in `notes`) instead of failing the request.

## 8. Reasoning and safety

- Headlines and snippets are **untrusted data**. The prompt labels them as data and instructs the model
  never to follow instructions found inside them. Output is constrained by a JSON schema, so a hostile
  headline cannot change the response format or trigger actions (there are none to trigger).
- The model may cite only source ids it was given. After the call, the server validates the schema and
  the grounding: any case point whose `source_ids` are empty or unknown is dropped and noted. If either
  side or the whole answer loses all support, or fewer than 3 news items were fetched, the stance
  becomes `unclear`.
- One retry is allowed for a malformed response. A second failure returns 502.
- The prompt instructs calibrated language, to state uncertainty, and not to present the lean as a
  recommendation. The UI adds the not-financial-advice note regardless of model output.
- The position (shares, average cost, gain/loss) is sent to OpenAI only for held tickers and only when
  the user opts into personalization (the default for held tickers; the screen says so).

## 9. Persistence, caching and limits

Table `analyses`: `id`, `user_id` (always 1 for now), `ticker`, `position_hash`, `created_at`,
`expires_at`, `model`, `personalized`, `payload` (JSON of the Analysis). The cache key is
(`ticker`, `position_hash`, `personalized`), where the hash changes when shares or average cost change.

Config (environment, with defaults): `ANALYSIS_CACHE_HOURS=6`, `ANALYSIS_REFRESH_MIN_MINUTES=15`,
`ANALYSIS_DAILY_CAP=30`, `NEWS_TIMEOUT_SECONDS=10`, `LLM_TIMEOUT_SECONDS=45`, `OPENAI_MODEL` (no model
name hard-coded in code), `OPENAI_API_KEY`, `FINNHUB_API_KEY`.

A process-wide lock around the daily-cap counter and cache write keeps concurrent requests from both
spending the same budget slot (same single-process assumption as the trade lock).

## 10. App changes

- Screen `src/app/analysis/[ticker].tsx` (Stack, header shows the ticker). Entry points: a "Research
  with news" button on the position screen and on each watchlist row, and a "Research a ticker" input
  (ticker field plus button) at the top of the Watchlist tab.
- Content, top to bottom: stance chip (text label plus icon; color secondary) with confidence; summary;
  Case for; Case against; What would change this view; Sources (title, outlet, relative time, opens the
  link); a line "Generated 2h ago, uses your position" with Refresh; the not-financial-advice note.
  For a held ticker a "Use my position" switch (default on) controls `personalize`; turning it off
  re-requests the analysis without sending shares or cost to OpenAI.
- States: loading (analysis can take 10-30 seconds; show progress text), cached result with age, thin
  news ("Not enough recent news to form a view"), 429 with the retry time, 502/503 with a clear message
  and Retry, offline error.
- Safety in the UI: all text rendered as plain text (no HTML/markdown evaluation); links open only when
  the scheme is `https`; no key or prompt content in the client.
- Hooks: `useAnalysis(ticker)` (query on the cached GET, mutation for POST), reusing the existing
  `api.ts` request wrapper and `ErrorBanner`/`ErrorState`.
- Accessibility: the stance is spoken as text ("Lean: hold, medium confidence"); sources are real links.

## 11. Testing (all offline; no live network calls in the suite)

API: news normalization and de-duplication; selection limits; the grounding validator (unknown ids,
empty citations, thin news); prompt builder output (injection headline stays inside the data block);
OpenAI client mocked for success, malformed output (retry), timeout and error; cache hit, refresh
interval and daily cap; auth and degraded-source behavior.
App: hook and screen tests with the API mocked (loading, success, thin news, 429, 502); the safe-link
helper; the stance label text.
Manual only: one smoke run with real keys on a scratch database.

## 12. Privacy and security notes (inputs for the later audit)

Keys server-side only; outbound calls limited to the three configured hosts; headlines treated as
untrusted; the position data leaves the server only for held tickers and only toward OpenAI; logs must
not contain prompts or positions; the endpoint reuses the shared-key auth and adds its own caps.

## 13. Work items that are not code

- Create a free Finnhub API key and add `FINNHUB_API_KEY` to `freeman-api/.env`.
- Add `OPENAI_API_KEY` and `OPENAI_MODEL` to `freeman-api/.env` (never in chat or in the repo).

## 14. Open questions for the implementation plan

These are deliberately left to the plan's first tasks, to be checked against current provider docs
instead of memory: the exact Finnhub endpoints and free-tier terms; the GDELT DOC API query syntax and
how well a company-name query works for world-event relevance; the OpenAI structured-output call shape
and which configured model to default to; and the wording of the disclaimer. The endpoint names
mentioned in conversation (`company-news`, `news?category=general`, GDELT DOC 2.0) are from memory and
are not specified here.

## 15. Phasing

One piece, one plan: phase 7 on branches `phase-7-news-analysis` (app, own repo) and
`phase-7-news-analysis-api` (API, parent repo, local only). Test suites follow as phase 8, then the
security audit.
