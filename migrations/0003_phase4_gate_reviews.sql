CREATE TABLE gate_review_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  shop_connection_id TEXT NOT NULL,
  gate_id TEXT NOT NULL CHECK (gate_id IN ('G1','G2','G3')),
  protocol_version TEXT NOT NULL,
  build_version TEXT NOT NULL,
  evidence_revision TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256) = 64),
  automated_evidence_passed INTEGER NOT NULL DEFAULT 0 CHECK (automated_evidence_passed IN (0,1)),
  enabled_outcome_metrics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(enabled_outcome_metrics_json)),
  state TEXT NOT NULL CHECK (state IN ('not_started','collecting','ready_for_review','needs_attention','approved','blocked','stale','superseded')),
  superseded_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, shop_connection_id) REFERENCES shop_connections(tenant_id, id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX one_current_gate_review_run
ON gate_review_runs(tenant_id, shop_connection_id, gate_id)
WHERE superseded_at IS NULL;

CREATE TABLE gate_evidence_items (
  run_id TEXT NOT NULL REFERENCES gate_review_runs(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('listing','receipt','views_day','interpretation','fault','human_step')),
  label TEXT NOT NULL,
  instructions TEXT NOT NULL,
  metric_key TEXT,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  comparison_json TEXT NOT NULL CHECK (json_valid(comparison_json)),
  source_reference TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, item_id)
) STRICT;

CREATE TABLE gate_review_responses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('matched','resolved_difference','unavailable_disabled','differs','cannot_verify')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  evidence_revision TEXT NOT NULL,
  supersedes_response_id TEXT REFERENCES gate_review_responses(id),
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id, item_id) REFERENCES gate_evidence_items(run_id, item_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX gate_response_latest_idx ON gate_review_responses(run_id, item_id, created_at DESC);

CREATE TABLE gate_evidence_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES gate_review_runs(id) ON DELETE CASCADE,
  item_id TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/png','image/jpeg','application/pdf','application/json')),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 10485760),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id, item_id) REFERENCES gate_evidence_items(run_id, item_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE gate_fault_results (
  run_id TEXT NOT NULL REFERENCES gate_review_runs(id) ON DELETE CASCADE,
  fault_id TEXT NOT NULL CHECK (fault_id GLOB 'F[0-1][0-9]' AND length(fault_id) = 3),
  state TEXT NOT NULL CHECK (state IN ('not_run','running','passed','failed','needs_human_verification')),
  expected_behavior TEXT NOT NULL,
  observed_summary TEXT,
  artifact_sha256 TEXT CHECK (artifact_sha256 IS NULL OR length(artifact_sha256) = 64),
  executed_at TEXT,
  PRIMARY KEY (run_id, fault_id)
) STRICT;

CREATE TABLE gate_approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES gate_review_runs(id) ON DELETE RESTRICT,
  gate_id TEXT NOT NULL CHECK (gate_id IN ('G1','G2','G3')),
  section_id TEXT,
  actor_id TEXT NOT NULL,
  evidence_revision TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256) = 64),
  protocol_version TEXT NOT NULL,
  build_version TEXT NOT NULL,
  disposition TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX gate_runs_scope_idx ON gate_review_runs(tenant_id, shop_connection_id, gate_id, updated_at DESC);
CREATE INDEX gate_items_run_order_idx ON gate_evidence_items(run_id, sort_order);
CREATE INDEX gate_approvals_run_idx ON gate_approvals(run_id, created_at DESC);
