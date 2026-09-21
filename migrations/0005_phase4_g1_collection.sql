CREATE TABLE etsy_read_budget_daily (
  shop_connection_id TEXT NOT NULL REFERENCES shop_connections(id) ON DELETE CASCADE,
  utc_date TEXT NOT NULL CHECK (utc_date GLOB '????-??-??'),
  requests_reserved INTEGER NOT NULL DEFAULT 0 CHECK (requests_reserved BETWEEN 0 AND 12),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_connection_id, utc_date)
) STRICT;

CREATE TABLE etsy_read_reservations (
  id TEXT PRIMARY KEY,
  shop_connection_id TEXT NOT NULL REFERENCES shop_connections(id) ON DELETE CASCADE,
  utc_date TEXT NOT NULL,
  request_limit INTEGER NOT NULL CHECK (request_limit BETWEEN 1 AND 12),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX etsy_read_reservations_shop_day_idx
ON etsy_read_reservations(shop_connection_id, utc_date, created_at);
