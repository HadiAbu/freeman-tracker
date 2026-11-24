# freeman-api

FastAPI + Turso (libSQL) backend for the Freeman portfolio tracker. Multi-user: each account sees
only its own trades, watchlist, holdings, manual prices and analyses.

## Run

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Windows; use .venv/bin/pip elsewhere
cp .env.example .env                               # then set JWT_SECRET
.venv/Scripts/python -m scripts.create_user you@example.com   # make your account
.venv/Scripts/python -m uvicorn app.main:app --reload --host 0.0.0.0
```

Docs at `http://localhost:8000/docs`. Tables are created on startup.
A phone on the same network reaches it at `http://<LAN-IP>:8000`.

## Test

```bash
.venv/Scripts/python -m pytest -q
```

## Accounts and sign-in

Send `Authorization: Bearer <access_token>` on every request except `/health` and `/auth/*`.

| | |
|---|---|
| `POST /auth/login` `{email, password}` | Returns `access_token` (15 min), `refresh_token` (30 days, single use), `expires_in`. 401 for any wrong credential, with one message. 429 after 5 failures per account or address in 15 minutes (`Retry-After`). |
| `POST /auth/refresh` `{refresh_token}` | Swaps a refresh token for a new pair. The old one stops working. Presenting a used token again ends every session in its family. |
| `POST /auth/logout` `{refresh_token}` | Ends that session. Always 204. |
| `GET /auth/me` | The signed-in account. |
| `POST /auth/register` | Only when `ALLOW_REGISTRATION=true`; 403 otherwise. Prefer `scripts.create_user`. |

Passwords are hashed with argon2id. Refresh tokens are stored only as SHA-256 hashes. With
`JWT_SECRET` unset the server fails closed (503).

**Upgrading a database from the single-user version.** All existing data is owned by user id 1, and
existing price marks are assigned to id 1 on startup. The first account you create gets id 1 and so
inherits everything. Create it before enabling registration.

## Endpoints (all but `/health` and `/auth/*` need a bearer token)

| | |
|---|---|
| `POST/GET /trades`, `PATCH/DELETE /trades/{id}` | Buys and sells. Changes that would oversell return 409. |
| `POST/GET /watchlist`, `PATCH/DELETE /watchlist/{id}` | Watchlist with target price; GET adds latest price and `pct_to_target`. |
| `POST /prices`, `GET /prices`, `GET /prices/{ticker}` | Manual price marks (latest per ticker / history). A manual mark is private to its owner. |
| `POST /prices/refresh` | Fetches current market prices (Finnhub) for your open positions and watchlist and stores them as shared `market` marks, one per ticker per day. Needs `FINNHUB_API_KEY` (else 503). A provider failure is not an error: failed tickers are listed in `failed` and keep their last price. Quotes are cached for 120 s across all users. |
| `PUT /holdings/{ticker}` | Name, sector, asset class (for allocation pies). |
| `GET /portfolio/summary` | Value, cost, unrealized and realized P&L, per-holding rows. |
| `GET /portfolio/allocation?by=ticker\|sector\|asset_class` | Pie slices: label, value, percent. |
| `GET /portfolio/history` | Portfolio value per date, for the line chart. |

Which price counts: the newest day wins; on the same day your own manual mark beats a market one.
Holdings and watchlist items report `price_kind` (`manual`, `market` or `trade`) and `price_as_of`.

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
