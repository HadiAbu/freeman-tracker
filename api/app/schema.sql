-- Every user-owned table carries user_id. There is deliberately no DEFAULT: a query or insert
-- that forgets the owner must fail, not quietly land on someone else's data. (Databases created
-- before accounts existed keep their old DEFAULT 1; the application always passes user_id.)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Where price alerts are sent. Separate from the login email, which can be a placeholder.
  alert_email TEXT
);

-- Opaque refresh tokens, stored only as a SHA-256 hash. A token is single use: refreshing
-- revokes it and issues a new one in the same family. Presenting a revoked token revokes the
-- whole family (a stolen token was replayed).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  family_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens (family_id);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT,
  sector TEXT,
  asset_class TEXT,
  UNIQUE (user_id, ticker)
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  shares REAL NOT NULL CHECK (shares > 0),
  price REAL NOT NULL CHECK (price >= 0),
  fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  traded_at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_trades_user_ticker ON trades (user_id, ticker, traded_at);

-- upper_limit / lower_limit: email the user when the price reaches them. A state is 'armed'
-- (will email on the next crossing) or 'triggered' (already past the limit, quiet until the price
-- crosses back). last_alerted_at is when this item last sent an email.
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT,
  upper_limit REAL,
  lower_limit REAL,
  upper_state TEXT NOT NULL DEFAULT 'armed',
  lower_state TEXT NOT NULL DEFAULT 'armed',
  last_alerted_at TEXT,
  note TEXT,
  UNIQUE (user_id, ticker)
);

-- Price marks. user_id is the owner of a manual mark; NULL means a market-data mark that every
-- user sees. (The idx_prices_* indexes are created in code, after the column is guaranteed to
-- exist on databases that predate it.)
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  ticker TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  as_of TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
);

-- Cached news analyses. Cache key: (user_id, ticker, position_hash, personalized).
CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ticker TEXT NOT NULL,
  position_hash TEXT NOT NULL,
  personalized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  model TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyses_lookup
  ON analyses (user_id, ticker, position_hash, personalized, created_at);
