import { deriveGateStatus, gateDefinitions, type GateId, type GateReviewResponse } from "../../../packages/gates/src/index.ts";

interface RunRow {
  id: string;
  gate_id: GateId;
  protocol_version: string;
  build_version: string;
  evidence_revision: string;
  evidence_sha256: string;
  automated_evidence_passed: number;
  enabled_outcome_metrics_json: string;
  state: string;
  approved_evidence_revision: string | null;
}

interface ItemRow {
  item_id: string;
  category: string;
  label: string;
  instructions: string;
  metric_key: string | null;
  required: number;
  sort_order: number;
  comparison_json: string;
  source_reference: string | null;
}

interface ResponseRow {
  id: string;
  item_id: string;
  outcome: GateReviewResponse["outcome"];
  note: string;
  evidence_revision: string;
  created_at: string;
}

export interface GateEvidenceItemInput {
  itemId: string;
  category: "listing" | "receipt" | "views_day" | "interpretation" | "fault" | "human_step";
  label: string;
  instructions: string;
  metricKey?: string;
  required: boolean;
  comparison: Record<string, unknown>;
  sourceReference?: string;
}

export interface StartGateRunInput {
  gateId: GateId;
  protocolVersion: string;
  buildVersion: string;
  evidenceRevision: string;
  evidenceSha256: string;
  automatedEvidencePassed: boolean;
  enabledOutcomeMetrics: string[];
  items: GateEvidenceItemInput[];
}

export class GateRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async listSession(actorId: string): Promise<{ tenants: Array<{ id: string; name: string; role: string; shops: Array<{ id: string; externalShopId: string; status: string }> }> }> {
    const rows = await this.db.prepare(`
      SELECT t.id tenant_id,t.name tenant_name,m.role,s.id shop_id,s.external_shop_id,s.status shop_status
      FROM memberships m JOIN tenants t ON t.id=m.tenant_id
      LEFT JOIN shop_connections s ON s.tenant_id=t.id
      WHERE m.actor_id=? AND m.active=1
      ORDER BY t.name,s.created_at
    `).bind(actorId).all<{ tenant_id: string; tenant_name: string; role: string; shop_id: string | null; external_shop_id: string | null; shop_status: string | null }>();
    const tenants = new Map<string, { id: string; name: string; role: string; shops: Array<{ id: string; externalShopId: string; status: string }> }>();
    for (const row of rows.results) {
      const tenant = tenants.get(row.tenant_id) ?? { id: row.tenant_id, name: row.tenant_name, role: row.role, shops: [] };
      if (row.shop_id && row.external_shop_id && row.shop_status) tenant.shops.push({ id: row.shop_id, externalShopId: row.external_shop_id, status: row.shop_status });
      tenants.set(row.tenant_id, tenant);
    }
    return { tenants: [...tenants.values()] };
  }

  async loadCollectionAuthority(scope: { tenantId: string; shopId: string; actorId: string }): Promise<{ externalShopId: string; scopes: string[] }> {
    const row = await this.db.prepare(`
      SELECT s.external_shop_id,s.scopes_json
      FROM memberships m
      JOIN shop_connections s ON s.tenant_id=m.tenant_id
      JOIN policies p ON p.tenant_id=s.tenant_id AND p.shop_connection_id=s.id
      WHERE m.tenant_id=? AND m.actor_id=? AND m.active=1 AND m.role='owner'
        AND s.id=? AND s.status='active'
        AND p.application_kill_switch=0 AND p.shop_kill_switch=0
    `).bind(scope.tenantId, scope.actorId, scope.shopId).first<{ external_shop_id: string; scopes_json: string }>();
    if (!row) throw new Error("collection_authority_not_found");
    const scopes = parseStringArray(row.scopes_json);
    if (!scopes.includes("listings_r") || !scopes.includes("transactions_r") || !scopes.includes("shops_r")) {
      throw new Error("collection_scopes_missing");
    }
    return { externalShopId: row.external_shop_id, scopes };
  }

  async reserveCollectionReads(scope: { tenantId: string; shopId: string; actorId: string }, requestLimit: number, now: string): Promise<string> {
    await this.assertOwner(scope.tenantId, scope.shopId, scope.actorId);
    if (!Number.isInteger(requestLimit) || requestLimit < 1 || requestLimit > 12) throw new Error("collection_budget_invalid");
    const utcDate = now.slice(0, 10);
    const reserved = await this.db.prepare(`
      INSERT INTO etsy_read_budget_daily(shop_connection_id,utc_date,requests_reserved,updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(shop_connection_id,utc_date) DO UPDATE SET
        requests_reserved=etsy_read_budget_daily.requests_reserved+excluded.requests_reserved,
        updated_at=excluded.updated_at
      WHERE etsy_read_budget_daily.requests_reserved+excluded.requests_reserved<=12
    `).bind(scope.shopId, utcDate, requestLimit, now).run();
    if ((reserved.meta.changes ?? 0) !== 1) throw new Error("collection_daily_budget_exhausted");
    const reservationId = crypto.randomUUID();
    await this.db.batch([
      this.db.prepare(`INSERT INTO etsy_read_reservations(id,shop_connection_id,utc_date,request_limit,created_by,created_at) VALUES(?,?,?,?,?,?)`)
        .bind(reservationId, scope.shopId, utcDate, requestLimit, scope.actorId, now),
      this.audit(scope, "etsy_read_budget_reserved", { reservation_id: reservationId, request_limit: requestLimit, utc_date: utcDate }, now),
    ]);
    return reservationId;
  }

  async startRun(scope: { tenantId: string; shopId: string; actorId: string }, input: StartGateRunInput, now: string): Promise<string> {
    await this.assertOwner(scope.tenantId, scope.shopId, scope.actorId);
    if (input.items.length === 0 || new Set(input.items.map((item) => item.itemId)).size !== input.items.length) throw new Error("gate_items_invalid");
    const runId = crypto.randomUUID();
    const previous = await this.db.prepare(`SELECT id FROM gate_review_runs WHERE tenant_id=? AND shop_connection_id=? AND gate_id=? AND superseded_at IS NULL`)
      .bind(scope.tenantId, scope.shopId, input.gateId).first<{ id: string }>();
    const statements: D1PreparedStatement[] = [];
    if (previous) statements.push(this.db.prepare(`UPDATE gate_review_runs SET state='superseded',superseded_at=?,updated_at=? WHERE id=? AND superseded_at IS NULL`).bind(now, now, previous.id));
    statements.push(this.db.prepare(`
      INSERT INTO gate_review_runs(id,tenant_id,shop_connection_id,gate_id,protocol_version,build_version,evidence_revision,evidence_sha256,automated_evidence_passed,enabled_outcome_metrics_json,state,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?, 'ready_for_review',?,?,?)
    `).bind(runId, scope.tenantId, scope.shopId, input.gateId, input.protocolVersion, input.buildVersion, input.evidenceRevision, input.evidenceSha256,
      input.automatedEvidencePassed ? 1 : 0, JSON.stringify(input.enabledOutcomeMetrics), scope.actorId, now, now));
    for (const [index, item] of input.items.entries()) {
      statements.push(this.db.prepare(`
        INSERT INTO gate_evidence_items(run_id,item_id,category,label,instructions,metric_key,required,sort_order,comparison_json,source_reference,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
      `).bind(runId, item.itemId, item.category, item.label, item.instructions, item.metricKey ?? null, item.required ? 1 : 0, index,
        JSON.stringify(item.comparison), item.sourceReference ?? null, now));
    }
    statements.push(this.audit(scope, "gate_review_run_started", { gate_id: input.gateId, run_id: runId, evidence_sha256: input.evidenceSha256 }, now));
    await this.db.batch(statements);
    return runId;
  }

  async dependenciesReady(scope: { tenantId: string; shopId: string; actorId: string }, gateId: GateId): Promise<boolean> {
    await this.assertOwner(scope.tenantId, scope.shopId, scope.actorId);
    return this.dependenciesApproved(scope.tenantId, scope.shopId, gateId);
  }

  async recordResponse(scope: { tenantId: string; shopId: string; actorId: string }, runId: string, itemId: string, outcome: GateReviewResponse["outcome"], note: string, evidenceRevision: string, now: string): Promise<void> {
    await this.assertMember(scope.tenantId, scope.shopId, scope.actorId, ["owner", "editor"]);
    const run = await this.loadRun(scope.tenantId, scope.shopId, runId);
    if (run.evidence_revision !== evidenceRevision || run.state === "superseded") throw new Error("gate_evidence_stale");
    if (run.state === "approved") throw new Error("gate_run_closed");
    const item = await this.db.prepare(`SELECT 1 ok FROM gate_evidence_items WHERE run_id=? AND item_id=?`).bind(runId, itemId).first<{ ok: number }>();
    if (!item) throw new Error("gate_item_not_found");
    const previous = await this.db.prepare(`SELECT id FROM gate_review_responses WHERE run_id=? AND item_id=? ORDER BY created_at DESC,id DESC LIMIT 1`)
      .bind(runId, itemId).first<{ id: string }>();
    const responseId = crypto.randomUUID();
    await this.db.batch([
      this.db.prepare(`INSERT INTO gate_review_responses(id,run_id,item_id,actor_id,outcome,note,evidence_revision,supersedes_response_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(responseId, runId, itemId, scope.actorId, outcome, note, evidenceRevision, previous?.id ?? null, now),
      this.audit(scope, "gate_review_response_recorded", { run_id: runId, item_id: itemId, outcome, response_id: responseId }, now),
    ]);
  }

  async recordArtifact(
    scope: { tenantId: string; shopId: string; actorId: string },
    input: { runId: string; itemId: string; r2Key: string; mediaType: string; byteLength: number; contentSha256: string },
    now: string,
  ): Promise<void> {
    await this.assertMember(scope.tenantId, scope.shopId, scope.actorId, ["owner", "editor"]);
    const run = await this.loadRun(scope.tenantId, scope.shopId, input.runId);
    if (run.state === "superseded") throw new Error("gate_evidence_stale");
    if (run.state === "approved") throw new Error("gate_run_closed");
    const item = await this.db.prepare(`SELECT 1 ok FROM gate_evidence_items WHERE run_id=? AND item_id=?`).bind(input.runId, input.itemId).first<{ ok: number }>();
    if (!item) throw new Error("gate_item_not_found");
    await this.db.batch([
      this.db.prepare(`INSERT INTO gate_evidence_artifacts(id,run_id,item_id,r2_key,media_type,byte_length,content_sha256,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), input.runId, input.itemId, input.r2Key, input.mediaType, input.byteLength, input.contentSha256, scope.actorId, now),
      this.audit(scope, "gate_evidence_artifact_added", { run_id: input.runId, item_id: input.itemId, content_sha256: input.contentSha256, byte_length: input.byteLength }, now),
    ]);
  }

  async approve(scope: { tenantId: string; shopId: string; actorId: string }, runId: string, disposition: string, now: string): Promise<void> {
    await this.assertOwner(scope.tenantId, scope.shopId, scope.actorId);
    const current = await this.loadRun(scope.tenantId, scope.shopId, runId);
    if (current.state === "approved") throw new Error("gate_already_approved");
    const workspace = await this.getRun(scope, runId);
    if (!workspace.review.canApprove) throw new Error("gate_not_approvable");
    const expectedDisposition: Record<GateId, string> = { G1: "owner_approved", G2: "directional_only", G3: "title_canary_only" };
    if (disposition !== expectedDisposition[workspace.gate.id]) throw new Error("gate_disposition_invalid");
    const approvalId = crypto.randomUUID();
    const results = await this.db.batch([
      this.db.prepare(`
        INSERT INTO gate_approvals(id,run_id,gate_id,actor_id,evidence_revision,evidence_sha256,protocol_version,build_version,disposition,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
          SELECT 1 FROM gate_review_runs WHERE id=? AND tenant_id=? AND shop_connection_id=?
            AND evidence_revision=? AND superseded_at IS NULL AND state!='approved'
        )
      `).bind(approvalId, runId, workspace.gate.id, scope.actorId, workspace.run.evidenceRevision, workspace.run.evidenceSha256,
          workspace.run.protocolVersion, workspace.run.buildVersion, disposition, now, runId, scope.tenantId, scope.shopId, workspace.run.evidenceRevision),
      this.db.prepare(`UPDATE gate_review_runs SET state='approved',updated_at=? WHERE id=? AND evidence_revision=? AND superseded_at IS NULL AND state!='approved'`)
        .bind(now, runId, workspace.run.evidenceRevision),
      this.audit(scope, "gate_approved", { run_id: runId, gate_id: workspace.gate.id, evidence_sha256: workspace.run.evidenceSha256, disposition }, now),
    ]);
    if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) throw new Error("gate_approval_conflict");
  }

  async listGates(scope: { tenantId: string; shopId: string; actorId: string }): Promise<{ gates: unknown[] }> {
    await this.assertMember(scope.tenantId, scope.shopId, scope.actorId, ["owner", "editor", "viewer"]);
    const gates = [];
    for (const gateId of ["G1", "G2", "G3"] as const) {
      const row = await this.db.prepare(`SELECT id FROM gate_review_runs WHERE tenant_id=? AND shop_connection_id=? AND gate_id=? AND superseded_at IS NULL`)
        .bind(scope.tenantId, scope.shopId, gateId).first<{ id: string }>();
      const dependenciesApproved = await this.dependenciesApproved(scope.tenantId, scope.shopId, gateId);
      gates.push(row ? await this.getRun(scope, row.id) : { gate: gateDefinitions[gateId], run: null, review: { status: dependenciesApproved ? "not_started" : "blocked", completed: 0, total: 0, canApprove: false, blockers: dependenciesApproved ? [] : ["dependency_not_approved"] }, items: [] });
    }
    return { gates };
  }

  async getRun(scope: { tenantId: string; shopId: string; actorId: string }, runId: string) {
    await this.assertMember(scope.tenantId, scope.shopId, scope.actorId, ["owner", "editor", "viewer"]);
    const run = await this.loadRun(scope.tenantId, scope.shopId, runId);
    const itemResult = await this.db.prepare(`SELECT * FROM gate_evidence_items WHERE run_id=? ORDER BY sort_order`).bind(runId).all<ItemRow>();
    const responseResult = await this.db.prepare(`
      SELECT r.* FROM gate_review_responses r
      WHERE r.run_id=? AND NOT EXISTS (
        SELECT 1 FROM gate_review_responses newer WHERE newer.run_id=r.run_id AND newer.item_id=r.item_id
          AND (newer.created_at>r.created_at OR (newer.created_at=r.created_at AND newer.id>r.id))
      )
    `).bind(runId).all<ResponseRow>();
    const responses = Object.fromEntries(responseResult.results.map((row) => [row.item_id, { outcome: row.outcome, evidenceRevision: row.evidence_revision }]));
    const dependenciesApproved = await this.dependenciesApproved(scope.tenantId, scope.shopId, run.gate_id);
    const review = deriveGateStatus({
      gateId: run.gate_id,
      evidenceRevision: run.evidence_revision,
      automatedEvidencePassed: run.automated_evidence_passed === 1,
      dependenciesApproved,
      requiredItems: itemResult.results.filter((item) => item.required === 1).map((item) => item.item_id),
      responses,
      enabledOutcomeMetrics: parseStringArray(run.enabled_outcome_metrics_json),
      ...(run.approved_evidence_revision ? { approvedEvidenceRevision: run.approved_evidence_revision } : {}),
      superseded: run.state === "superseded",
      collecting: run.state === "collecting",
    });
    return {
      gate: gateDefinitions[run.gate_id],
      run: { id: run.id, protocolVersion: run.protocol_version, buildVersion: run.build_version, evidenceRevision: run.evidence_revision, evidenceSha256: run.evidence_sha256 },
      review,
      items: itemResult.results.map((item) => ({
        id: item.item_id, category: item.category, label: item.label, instructions: item.instructions, metricKey: item.metric_key,
        required: item.required === 1, comparison: parseObject(item.comparison_json), sourceReference: item.source_reference,
        response: responseResult.results.find((response) => response.item_id === item.item_id) ?? null,
      })),
    };
  }

  private async dependenciesApproved(tenantId: string, shopId: string, gateId: GateId): Promise<boolean> {
    if (gateId === "G1") return true;
    const required = gateId === "G2" ? ["G1"] : ["G1", "G2"];
    for (const dependency of required) {
      const row = await this.db.prepare(`SELECT 1 ok FROM gate_review_runs WHERE tenant_id=? AND shop_connection_id=? AND gate_id=? AND state='approved' AND superseded_at IS NULL`)
        .bind(tenantId, shopId, dependency).first<{ ok: number }>();
      if (!row) return false;
    }
    return true;
  }

  private async loadRun(tenantId: string, shopId: string, runId: string): Promise<RunRow> {
    const row = await this.db.prepare(`
      SELECT r.*, (SELECT evidence_revision FROM gate_approvals a WHERE a.run_id=r.id AND a.section_id IS NULL ORDER BY created_at DESC LIMIT 1) approved_evidence_revision
      FROM gate_review_runs r WHERE r.id=? AND r.tenant_id=? AND r.shop_connection_id=?
    `).bind(runId, tenantId, shopId).first<RunRow>();
    if (!row) throw new Error("gate_run_not_found");
    return row;
  }

  private async assertOwner(tenantId: string, shopId: string, actorId: string): Promise<void> {
    return this.assertMember(tenantId, shopId, actorId, ["owner"]);
  }

  private async assertMember(tenantId: string, shopId: string, actorId: string, roles: string[]): Promise<void> {
    const placeholders = roles.map(() => "?").join(",");
    const row = await this.db.prepare(`SELECT 1 ok FROM memberships m JOIN shop_connections s ON s.tenant_id=m.tenant_id WHERE m.tenant_id=? AND m.actor_id=? AND m.active=1 AND m.role IN (${placeholders}) AND s.id=?`)
      .bind(tenantId, actorId, ...roles, shopId).first<{ ok: number }>();
    if (!row) throw new Error("role_forbidden");
  }

  private audit(scope: { tenantId: string; shopId: string; actorId: string }, eventType: string, payload: Record<string, unknown>, now: string): D1PreparedStatement {
    return this.db.prepare(`INSERT INTO audit_events(id,tenant_id,shop_connection_id,actor_id,event_type,redacted_payload_json,created_at) VALUES(?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), scope.tenantId, scope.shopId, scope.actorId, eventType, JSON.stringify(payload), now);
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
  } catch { return []; }
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
