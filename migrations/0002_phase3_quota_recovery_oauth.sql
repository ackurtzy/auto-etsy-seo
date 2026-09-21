CREATE TABLE quota_daily (
  shop_connection_id TEXT NOT NULL REFERENCES shop_connections(id) ON DELETE CASCADE,
  utc_date TEXT NOT NULL,
  writes_used INTEGER NOT NULL DEFAULT 0 CHECK (writes_used >= 0),
  recovery_reads_used INTEGER NOT NULL DEFAULT 0 CHECK (recovery_reads_used >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_connection_id, utc_date)
) STRICT;

CREATE TABLE quota_reservations (
  operation_id TEXT PRIMARY KEY REFERENCES operations(id) ON DELETE RESTRICT,
  shop_connection_id TEXT NOT NULL REFERENCES shop_connections(id) ON DELETE CASCADE,
  utc_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('write','recovery_read')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE backup_manifests (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  d1_backup_reference TEXT NOT NULL,
  r2_manifest_key TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  executor_version TEXT NOT NULL,
  tombstone_watermark TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  state TEXT NOT NULL CHECK (state IN ('prepared','verified','failed')),
  created_at TEXT NOT NULL,
  verified_at TEXT
) STRICT;

CREATE TABLE oauth_states (
  state_digest TEXT PRIMARY KEY CHECK (length(state_digest) = 64),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  expected_external_shop_id TEXT NOT NULL,
  verifier_algorithm TEXT NOT NULL CHECK (verifier_algorithm = 'AES-GCM-256'),
  verifier_nonce TEXT NOT NULL,
  verifier_ciphertext TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX oauth_states_expiry_idx ON oauth_states(expires_at);
CREATE INDEX quota_reservation_shop_day_idx ON quota_reservations(shop_connection_id, utc_date);
