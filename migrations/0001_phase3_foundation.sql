PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL DEFAULT 1 CHECK (authority_epoch >= 1),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  authority_epoch INTEGER NOT NULL DEFAULT 1 CHECK (authority_epoch >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, actor_id)
) STRICT;

CREATE TABLE shop_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_shop_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked', 'disconnected')),
  scopes_json TEXT NOT NULL CHECK (json_valid(scopes_json)),
  authority_epoch INTEGER NOT NULL DEFAULT 1 CHECK (authority_epoch >= 1),
  token_version INTEGER,
  write_lane_state TEXT NOT NULL DEFAULT 'open' CHECK (write_lane_state IN ('open', 'blocked', 'paused')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, id)
) STRICT;

CREATE TABLE credential_versions (
  shop_connection_id TEXT NOT NULL REFERENCES shop_connections(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  algorithm TEXT NOT NULL CHECK (algorithm = 'AES-GCM-256'),
  access_nonce TEXT NOT NULL,
  access_ciphertext TEXT NOT NULL,
  refresh_nonce TEXT NOT NULL,
  refresh_ciphertext TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (shop_connection_id, version)
) STRICT;

CREATE TABLE capability_grants (
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('title', 'tags')),
  mode TEXT NOT NULL CHECK (mode IN ('disabled', 'canary', 'enabled')),
  authority_epoch INTEGER NOT NULL DEFAULT 1 CHECK (authority_epoch >= 1),
  executor_version TEXT NOT NULL,
  gate_hash TEXT,
  canary_listing_id TEXT,
  canary_baseline_digest TEXT,
  canary_proposed_digest TEXT,
  canary_expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, shop_connection_id, field),
  FOREIGN KEY (tenant_id, shop_connection_id) REFERENCES shop_connections(tenant_id, id) ON DELETE CASCADE,
  CHECK (
    (mode = 'canary' AND gate_hash IS NOT NULL AND canary_listing_id IS NOT NULL AND canary_baseline_digest IS NOT NULL AND canary_proposed_digest IS NOT NULL AND canary_expires_at IS NOT NULL)
    OR mode IN ('disabled', 'enabled')
  )
) STRICT;

CREATE TABLE policies (
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT NOT NULL,
  application_kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (application_kill_switch IN (0, 1)),
  shop_kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (shop_kill_switch IN (0, 1)),
  daily_write_limit INTEGER NOT NULL DEFAULT 0 CHECK (daily_write_limit >= 0),
  recovery_read_reserve INTEGER NOT NULL DEFAULT 25 CHECK (recovery_read_reserve >= 5),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, shop_connection_id),
  FOREIGN KEY (tenant_id, shop_connection_id) REFERENCES shop_connections(tenant_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE listing_revisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  title TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source_revision TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, shop_connection_id) REFERENCES shop_connections(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, shop_connection_id, listing_id, source_digest)
) STRICT;

CREATE TABLE listing_current (
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  revision_id TEXT NOT NULL REFERENCES listing_revisions(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, shop_connection_id, listing_id),
  FOREIGN KEY (tenant_id, shop_connection_id) REFERENCES shop_connections(tenant_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  command_type TEXT NOT NULL CHECK (command_type IN ('apply_title', 'revert_title', 'verify_keep')),
  listing_id TEXT NOT NULL,
  baseline_title TEXT NOT NULL,
  proposed_title TEXT NOT NULL,
  baseline_digest TEXT NOT NULL,
  proposed_digest TEXT NOT NULL,
  tenant_epoch INTEGER NOT NULL,
  shop_epoch INTEGER NOT NULL,
  capability_epoch INTEGER NOT NULL,
  approval_expires_at TEXT NOT NULL,
  parent_operation_id TEXT,
  accepted_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, shop_connection_id) REFERENCES shop_connections(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, shop_connection_id, idempotency_key)
) STRICT;

CREATE TABLE operations (
  id TEXT PRIMARY KEY REFERENCES commands(id) ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','validating','prepared','dispatching','verifying','verified','rejected','cancelled_before_dispatch','unknown','conflict','manual_required')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  prepared_at TEXT,
  dispatched_at TEXT,
  verified_at TEXT,
  verification_kind TEXT,
  prewrite_revision_id TEXT REFERENCES listing_revisions(id),
  last_observation_revision_id TEXT REFERENCES listing_revisions(id),
  reconciliation_reads INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_reads >= 0),
  next_reconciliation_at TEXT,
  failure_code TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, shop_connection_id) REFERENCES shop_connections(tenant_id, id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX one_unresolved_operation_per_shop
ON operations(shop_connection_id)
WHERE state IN ('queued','validating','prepared','dispatching','verifying','unknown','manual_required');

CREATE TABLE operation_attempts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal = 1),
  marked_potentially_sent_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pending','response_received','transport_ambiguous')),
  response_status INTEGER,
  completed_at TEXT,
  UNIQUE (operation_id, ordinal)
) STRICT;

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operations(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind = 'dispatch_title'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','leased','started','done','dead')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  available_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT NOT NULL,
  operation_id TEXT REFERENCES operations(id),
  workflow_instance_id TEXT UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('queued','running','waiting','complete','failed','paused')),
  version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, shop_connection_id) REFERENCES shop_connections(tenant_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT NOT NULL,
  operation_id TEXT REFERENCES operations(id),
  listing_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  observed_title TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  quality_flags_json TEXT NOT NULL CHECK (json_valid(quality_flags_json)),
  FOREIGN KEY (tenant_id, shop_connection_id) REFERENCES shop_connections(tenant_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT,
  actor_id TEXT,
  operation_id TEXT,
  event_type TEXT NOT NULL,
  redacted_payload_json TEXT NOT NULL CHECK (json_valid(redacted_payload_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT,
  operation_id TEXT,
  code TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open','acknowledged','resolved')),
  notification_state TEXT NOT NULL CHECK (notification_state IN ('pending','sent','failed','not_configured')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE deletion_tombstones (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT,
  recovery_journal_key TEXT NOT NULL UNIQUE,
  recorded_at TEXT NOT NULL
) STRICT;

CREATE TABLE restore_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  status TEXT NOT NULL CHECK (status IN ('normal','quarantined','reconciled')),
  egress_enabled INTEGER NOT NULL DEFAULT 0 CHECK (egress_enabled IN (0, 1)),
  source_backup_id TEXT,
  tombstone_overlay_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO restore_state(singleton, status, egress_enabled, updated_at)
VALUES (1, 'normal', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE INDEX outbox_ready_idx ON outbox(state, available_at);
CREATE INDEX operations_shop_state_idx ON operations(shop_connection_id, state, updated_at);
CREATE INDEX observations_operation_idx ON observations(operation_id, fetched_at);
CREATE INDEX audit_tenant_time_idx ON audit_events(tenant_id, created_at);
CREATE INDEX incidents_open_idx ON incidents(state, created_at);
