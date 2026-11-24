# freeman-api

FastAPI + Turso (libSQL) backend for the Freeman portfolio tracker. Single user for now,
protected by a shared `X-API-Key`.

## Run

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Windows; use .venv/bin/pip elsewhere
cp .env.example .env                               # then set API_KEY
.venv/Scripts/python -m uvicorn app.main:app --reload --host 0.0.0.0
```

Docs at `http://localhost:8000/docs`. Tables are created on startup.
A phone on the same network reaches it at `http://<LAN-IP>:8000`.

## Test

```bash
.venv/Scripts/python -m pytest -q
```

## Endpoints (all but `/health` need `X-API-Key`)

| | |
|---|---|
| `POST/GET /trades`, `PATCH/DELETE /trades/{id}` | Buys and sells. Changes that would oversell return 409. |
| `POST/GET /watchlist`, `PATCH/DELETE /watchlist/{id}` | Watchlist with target price; GET adds latest price and `pct_to_target`. |
| `POST /prices`, `GET /prices`, `GET /prices/{ticker}` | Manual price marks (latest per ticker / history). |
| `PUT /holdings/{ticker}` | Name, sector, asset class (for allocation pies). |
| `GET /portfolio/summary` | Value, cost, unrealized and realized P&L, per-holding rows. |
| `GET /portfolio/allocation?by=ticker\|sector\|asset_class` | Pie slices: label, value, percent. |
| `GET /portfolio/history` | Portfolio value per date, for the line chart. |

Positions use the average-cost method (`app/portfolio.py`). A position with no price mark
is valued at its last trade price.

## News analysis (`/analysis`)

Optional. Needs these in `.env` (server-side only): `OPENAI_API_KEY`, `OPENAI_MODEL` (a model that
supports structured outputs) and `FINNHUB_API_KEY` (free at finnhub.io). Without them `POST /analysis`
answers 503 and names the missing settings.

| | |
|---|---|
| `POST /analysis` `{ticker, refresh?, personalize?}` | Fetches Finnhub and GDELT news, asks the model for a cited lean (buy/hold/sell/unclear), validates that every claim cites a fetched headline, caches it. 429 for the refresh interval or daily cap (with `Retry-After`), 502 when no news source or the model fails. |
| `GET /analysis/{ticker}` | The newest stored analysis (even if stale), or 404. Never calls a provider. |

Tuning (defaults): `ANALYSIS_CACHE_HOURS=6`, `ANALYSIS_REFRESH_MIN_MINUTES=15`, `ANALYSIS_DAILY_CAP=30`.
Informational only, not financial advice. For a held ticker the position (shares, average cost, gain/loss)
is sent to OpenAI unless the request sets `personalize: false`.
`scripts/capture_gdelt_sample.py` makes one live GDELT call to verify the response shape.
