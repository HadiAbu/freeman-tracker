-- user_id is always 1 for now; kept so real accounts can be added later.
CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  ticker TEXT NOT NULL,
  name TEXT,
  sector TEXT,
  asset_class TEXT,
  UNIQUE (user_id, ticker)
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  shares REAL NOT NULL CHECK (shares > 0),
  price REAL NOT NULL CHECK (price >= 0),
  fee REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  traded_at TEXT NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_trades_user_ticker ON trades (user_id, ticker, traded_at);

CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  ticker TEXT NOT NULL,
  name TEXT,
  target_price REAL,
  note TEXT,
  UNIQUE (user_id, ticker)
);

-- Price marks. Manual now; a provider can insert rows with another `source`.
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  as_of TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_prices_ticker_asof ON prices (ticker, as_of);

-- Cached news analyses. Cache key: (ticker, position_hash, personalized).
CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
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
