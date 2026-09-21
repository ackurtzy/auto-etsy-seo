import { buildTitleOperation, canonicalDigest, type AuthoritySnapshot, type TitleCommandInput, type TitleOperation } from "../../../packages/operations/src/index.ts";
import type { EncryptedCredential } from "../../../packages/security/src/credential-vault.ts";

interface AuthorityRow {
  actor_active: number;
  actor_role: "owner" | "editor" | "viewer";
  tenant_epoch: number;
  shop_epoch: number;
  capability_epoch: number;
  capability_mode: "disabled" | "canary" | "enabled";
  application_kill_switch: number;
  shop_kill_switch: number;
  scopes_json: string;
  gate_hash: string | null;
  canary_listing_id: string | null;
  canary_baseline_digest: string | null;
  canary_proposed_digest: string | null;
  canary_expires_at: string | null;
  restore_status: "normal" | "quarantined" | "reconciled";
  egress_enabled: number;
}

interface OperationRow {
  id: string;
  request_digest: string;
  idempotency_key: string;
  tenant_id: string;
  shop_connection_id: string;
  listing_id: string;
  actor_id: string;
  baseline_title: string;
  proposed_title: string;
  baseline_digest: string;
  proposed_digest: string;
  tenant_epoch: number;
  shop_epoch: number;
  capability_epoch: number;
  approval_expires_at: string;
  command_type: "apply_title" | "revert_title" | "verify_keep";
  parent_operation_id: string | null;
  accepted_at: string;
  state: TitleOperation["state"];
  version: number;
  prepared_at: string | null;
  dispatched_at: string | null;
  verified_at: string | null;
  verification_kind: TitleOperation["verificationKind"] | null;
  reconciliation_reads: number;
  failure_code: string | null;
}

export interface CredentialRow {
  tenant_id: string;
  shop_connection_id: string;
  external_shop_id: string;
  version: number;
  access_nonce: string;
  access_ciphertext: string;
  refresh_nonce: string;
  refresh_ciphertext: string;
  expires_at: string;
}

export class OperationRepository {
  constructor(private readonly db: D1Database) {}

  async loadAuthority(tenantId: string, shopId: string, actorId: string): Promise<AuthoritySnapshot> {
    const row = await this.db.prepare(`
      SELECT m.active actor_active, m.role actor_role,
             t.authority_epoch tenant_epoch, s.authority_epoch shop_epoch,
             g.authority_epoch capability_epoch, g.mode capability_mode,
             p.application_kill_switch, p.shop_kill_switch, s.scopes_json,
             g.gate_hash, g.canary_listing_id, g.canary_baseline_digest,
             g.canary_proposed_digest, g.canary_expires_at,
             r.status restore_status, r.egress_enabled
      FROM tenants t
      JOIN memberships m ON m.tenant_id = t.id AND m.actor_id = ?
      JOIN shop_connections s ON s.tenant_id = t.id AND s.id = ? AND s.status = 'active'
      JOIN capability_grants g ON g.tenant_id = t.id AND g.shop_connection_id = s.id AND g.field = 'title'
      JOIN policies p ON p.tenant_id = t.id AND p.shop_connection_id = s.id
      JOIN restore_state r ON r.singleton = 1
      WHERE t.id = ?
    `).bind(actorId, shopId, tenantId).first<AuthorityRow>();
    if (!row) throw new Error("authority_not_found");
    const scopes = JSON.parse(row.scopes_json) as unknown;
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === "string")) throw new Error("scope_contract_invalid");
    return {
      actorActive: row.actor_active === 1,
      actorRole: row.actor_role,
      tenantEpoch: row.tenant_epoch,
      shopEpoch: row.shop_epoch,
      capabilityEpoch: row.capability_epoch,
      capabilityMode: row.capability_mode,
      applicationKillSwitch: row.application_kill_switch === 1,
      shopKillSwitch: row.shop_kill_switch === 1,
      scopes,
      restoredQuarantine: row.restore_status === "quarantined" || row.egress_enabled !== 1,
      ...(row.capability_mode === "canary" && row.gate_hash && row.canary_listing_id && row.canary_baseline_digest && row.canary_proposed_digest && row.canary_expires_at
        ? { canary: {
            gateId: row.gate_hash,
            listingId: row.canary_listing_id,
            baselineDigest: row.canary_baseline_digest,
            proposedDigest: row.canary_proposed_digest,
            expiresAt: row.canary_expires_at,
          } }
        : {}),
    };
  }

  async assertTenantOwner(tenantId: string, actorId: string): Promise<void> {
    const row = await this.db.prepare(`SELECT 1 ok FROM memberships WHERE tenant_id=? AND actor_id=? AND active=1 AND role='owner'`)
      .bind(tenantId, actorId).first<{ ok: number }>();
    if (!row) throw new Error("role_forbidden");
  }

  async createShopConnection(input: {
    id: string;
    tenantId: string;
    actorId: string;
    externalShopId: string;
    scopes: string[];
    access: EncryptedCredential;
    refresh: EncryptedCredential;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    await this.assertTenantOwner(input.tenantId, input.actorId);
    await this.db.batch([
      this.db.prepare(`INSERT INTO shop_connections(id,tenant_id,external_shop_id,status,scopes_json,authority_epoch,token_version,write_lane_state,created_at,updated_at) VALUES(?,?,?,'active',?,1,1,'paused',?,?)`)
        .bind(input.id, input.tenantId, input.externalShopId, JSON.stringify(input.scopes), input.now, input.now),
      this.db.prepare(`INSERT INTO credential_versions(shop_connection_id,version,algorithm,access_nonce,access_ciphertext,refresh_nonce,refresh_ciphertext,expires_at,created_at) VALUES(?,1,?,?,?,?,?,?,?)`)
        .bind(input.id, input.access.algorithm, input.access.nonce, input.access.ciphertext, input.refresh.nonce, input.refresh.ciphertext, input.expiresAt, input.now),
      this.db.prepare(`INSERT INTO capability_grants(tenant_id,shop_connection_id,field,mode,authority_epoch,executor_version,updated_at) VALUES(?,?,'title','disabled',1,'title-v1',?)`)
        .bind(input.tenantId, input.id, input.now),
      this.db.prepare(`INSERT INTO capability_grants(tenant_id,shop_connection_id,field,mode,authority_epoch,executor_version,updated_at) VALUES(?,?,'tags','disabled',1,'tags-v1',?)`)
        .bind(input.tenantId, input.id, input.now),
      this.db.prepare(`INSERT INTO policies(tenant_id,shop_connection_id,application_kill_switch,shop_kill_switch,daily_write_limit,recovery_read_reserve,updated_at) VALUES(?,?,0,1,0,25,?)`)
        .bind(input.tenantId, input.id, input.now),
      this.db.prepare(`INSERT INTO audit_events(id,tenant_id,shop_connection_id,actor_id,event_type,redacted_payload_json,created_at) VALUES(?,?,?,?, 'shop_connected_disabled', ?, ?)`)
        .bind(crypto.randomUUID(), input.tenantId, input.id, input.actorId, JSON.stringify({ external_shop_id_digest: canonicalDigest(input.externalShopId), scopes: input.scopes }), input.now),
    ]);
  }

  async acceptTitleCommand(input: TitleCommandInput, authority: AuthoritySnapshot, now: string): Promise<{ operation: TitleOperation; duplicate: boolean }> {
    const operation = buildTitleOperation(input, authority, now);
    const existing = await this.db.prepare(`
      SELECT c.id, c.request_digest
      FROM commands c
      WHERE c.tenant_id = ? AND c.shop_connection_id = ? AND c.idempotency_key = ?
    `).bind(operation.tenantId, operation.shopId, operation.idempotencyKey).first<{ id: string; request_digest: string }>();
    if (existing) {
      if (existing.request_digest !== operation.requestDigest) throw new Error("idempotency_conflict");
      return { operation: await this.getOperation(existing.id), duplicate: true };
    }
    try {
      const results = await this.db.batch([
        this.db.prepare(`
          INSERT INTO commands(
            id, tenant_id, shop_connection_id, actor_id, idempotency_key, request_digest,
            command_type, listing_id, baseline_title, proposed_title, baseline_digest,
            proposed_digest, tenant_epoch, shop_epoch, capability_epoch,
            approval_expires_at, parent_operation_id, accepted_at
          )
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
          WHERE EXISTS (
            SELECT 1 FROM tenants t
            JOIN memberships m ON m.tenant_id=t.id AND m.actor_id=? AND m.active=1 AND m.role IN ('owner','editor')
            JOIN shop_connections s ON s.tenant_id=t.id AND s.id=? AND s.status='active' AND s.write_lane_state='open'
            JOIN capability_grants g ON g.tenant_id=t.id AND g.shop_connection_id=s.id AND g.field='title'
            JOIN policies p ON p.tenant_id=t.id AND p.shop_connection_id=s.id
            JOIN restore_state r ON r.singleton=1
            WHERE t.id=? AND t.authority_epoch=? AND s.authority_epoch=? AND g.authority_epoch=?
              AND p.application_kill_switch=0 AND p.shop_kill_switch=0
              AND r.status IN ('normal','reconciled') AND r.egress_enabled=1
              AND (g.mode='enabled' OR (g.mode='canary' AND g.canary_listing_id=?
                AND g.canary_baseline_digest=? AND g.canary_proposed_digest=? AND g.canary_expires_at>?))
          )
        `).bind(
          operation.id, operation.tenantId, operation.shopId, operation.actorId, operation.idempotencyKey,
          operation.requestDigest, operation.kind === "revert" ? "revert_title" : "apply_title", operation.listingId,
          operation.baselineTitle, operation.proposedTitle, operation.baselineDigest, operation.proposedDigest,
          operation.authority.tenantEpoch, operation.authority.shopEpoch, operation.authority.capabilityEpoch,
          operation.approvalExpiresAt, operation.parentOperationId ?? null, now,
          operation.actorId, operation.shopId, operation.tenantId,
          operation.authority.tenantEpoch, operation.authority.shopEpoch, operation.authority.capabilityEpoch,
          operation.listingId, operation.baselineDigest, operation.proposedDigest, now,
        ),
        this.db.prepare(`
          INSERT INTO operations(id, tenant_id, shop_connection_id, listing_id, state, updated_at)
          SELECT id, tenant_id, shop_connection_id, listing_id, 'queued', ? FROM commands WHERE id=?
        `).bind(now, operation.id),
        this.db.prepare(`
          INSERT INTO outbox(id, operation_id, kind, state, available_at, created_at, updated_at)
          SELECT ?, id, 'dispatch_title', 'pending', ?, ?, ? FROM commands WHERE id=?
        `).bind(`outbox:${operation.id}`, now, now, now, operation.id),
        this.auditStatement(operation, "command_accepted", now),
      ]);
      if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1 || (results[2]?.meta.changes ?? 0) !== 1) {
        throw new Error("conditional_acceptance_rejected");
      }
    } catch (error) {
      const raced = await this.db.prepare(`SELECT id, request_digest FROM commands WHERE tenant_id=? AND shop_connection_id=? AND idempotency_key=?`)
        .bind(operation.tenantId, operation.shopId, operation.idempotencyKey).first<{ id: string; request_digest: string }>();
      if (raced) {
        if (raced.request_digest !== operation.requestDigest) throw new Error("idempotency_conflict");
        return { operation: await this.getOperation(raced.id), duplicate: true };
      }
      throw error;
    }
    return { operation: await this.getOperation(operation.id), duplicate: false };
  }

  async getOperation(id: string): Promise<TitleOperation> {
    const row = await this.db.prepare(`
      SELECT c.*, o.state, o.version, o.prepared_at, o.dispatched_at, o.verified_at,
             o.verification_kind, o.reconciliation_reads, o.failure_code
      FROM commands c JOIN operations o ON o.id=c.id WHERE c.id=?
    `).bind(id).first<OperationRow>();
    if (!row) throw new Error("operation_not_found");
    return {
      id: row.id,
      requestDigest: row.request_digest,
      idempotencyKey: row.idempotency_key,
      tenantId: row.tenant_id,
      shopId: row.shop_connection_id,
      listingId: row.listing_id,
      actorId: row.actor_id,
      baselineTitle: row.baseline_title,
      proposedTitle: row.proposed_title,
      baselineDigest: row.baseline_digest,
      proposedDigest: row.proposed_digest,
      authority: { tenantEpoch: row.tenant_epoch, shopEpoch: row.shop_epoch, capabilityEpoch: row.capability_epoch },
      approvalExpiresAt: row.approval_expires_at,
      kind: row.command_type === "revert_title" ? "revert" : row.command_type === "verify_keep" ? "keep" : "apply",
      ...(row.parent_operation_id ? { parentOperationId: row.parent_operation_id } : {}),
      state: row.state,
      version: row.version,
      acceptedAt: row.accepted_at,
      ...(row.prepared_at ? { preparedAt: row.prepared_at } : {}),
      ...(row.dispatched_at ? { dispatchedAt: row.dispatched_at } : {}),
      ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
      ...(row.verification_kind ? { verificationKind: row.verification_kind } : {}),
      reconciliationReads: row.reconciliation_reads,
      ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    };
  }

  async getScopedOperation(id: string, tenantId: string, shopId: string): Promise<TitleOperation> {
    const operation = await this.getOperation(id);
    if (operation.tenantId !== tenantId || operation.shopId !== shopId) throw new Error("operation_not_found");
    return operation;
  }

  async loadCredential(shopId: string): Promise<CredentialRow> {
    const row = await this.db.prepare(`
      SELECT s.tenant_id, s.id shop_connection_id, s.external_shop_id, c.version,
             c.access_nonce, c.access_ciphertext, c.refresh_nonce, c.refresh_ciphertext, c.expires_at
      FROM shop_connections s JOIN credential_versions c
        ON c.shop_connection_id=s.id AND c.version=s.token_version AND c.revoked_at IS NULL
      WHERE s.id=? AND s.status='active'
    `).bind(shopId).first<CredentialRow>();
    if (!row) throw new Error("credential_unavailable");
    return row;
  }

  async recordKeep(
    parent: TitleOperation,
    actorId: string,
    idempotencyKey: string,
    observedTitle: string,
    now: string,
  ): Promise<TitleOperation> {
    const existing = await this.db.prepare(`SELECT id FROM commands WHERE tenant_id=? AND shop_connection_id=? AND idempotency_key=?`)
      .bind(parent.tenantId, parent.shopId, idempotencyKey).first<{ id: string }>();
    if (existing) return this.getOperation(existing.id);
    const id = crypto.randomUUID();
    const matches = canonicalDigest(observedTitle) === parent.proposedDigest;
    const digest = canonicalDigest(JSON.stringify({ parent: parent.id, actorId, idempotencyKey, observed: canonicalDigest(observedTitle), decision: "keep" }));
    await this.db.batch([
      this.db.prepare(`
        INSERT INTO commands(
          id,tenant_id,shop_connection_id,actor_id,idempotency_key,request_digest,command_type,
          listing_id,baseline_title,proposed_title,baseline_digest,proposed_digest,tenant_epoch,
          shop_epoch,capability_epoch,approval_expires_at,parent_operation_id,accepted_at
        ) VALUES(?,?,?,?,?,?,'verify_keep',?,?,?,?,?,?,?,?,?,?,?)
      `).bind(id, parent.tenantId, parent.shopId, actorId, idempotencyKey, digest, parent.listingId,
        parent.proposedTitle, parent.proposedTitle, parent.proposedDigest, parent.proposedDigest,
        parent.authority.tenantEpoch, parent.authority.shopEpoch, parent.authority.capabilityEpoch,
        parent.approvalExpiresAt, parent.id, now),
      this.db.prepare(`INSERT INTO operations(id,tenant_id,shop_connection_id,listing_id,state,verified_at,verification_kind,failure_code,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(id, parent.tenantId, parent.shopId, parent.listingId, matches ? "verified" : "conflict", matches ? now : null,
          matches ? "verified_observed_desired_state" : null, matches ? null : "verified_keep_conflict", now),
      this.db.prepare(`INSERT INTO audit_events(id,tenant_id,shop_connection_id,actor_id,operation_id,event_type,redacted_payload_json,created_at) VALUES(?,?,?,?,?,'keep_decision',?,?)`)
        .bind(crypto.randomUUID(), parent.tenantId, parent.shopId, actorId, id, JSON.stringify({ parent_operation_id: parent.id, matches }), now),
    ]);
    return this.getOperation(id);
  }

  async rotateCredential(
    current: CredentialRow,
    access: EncryptedCredential,
    refresh: EncryptedCredential,
    expiresAt: string,
    now: string,
  ): Promise<number> {
    const nextVersion = current.version + 1;
    const results = await this.db.batch([
      this.db.prepare(`
        INSERT INTO credential_versions(
          shop_connection_id,version,algorithm,access_nonce,access_ciphertext,
          refresh_nonce,refresh_ciphertext,expires_at,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
      `).bind(current.shop_connection_id, nextVersion, access.algorithm, access.nonce, access.ciphertext, refresh.nonce, refresh.ciphertext, expiresAt, now),
      this.db.prepare(`UPDATE shop_connections SET token_version=?,updated_at=? WHERE id=? AND token_version=?`)
        .bind(nextVersion, now, current.shop_connection_id, current.version),
    ]);
    if ((results[1]?.meta.changes ?? 0) !== 1) throw new Error("credential_rotation_conflict");
    return nextVersion;
  }

  async prepare(operation: TitleOperation, observedTitle: string, now: string): Promise<boolean> {
    const digest = canonicalDigest(observedTitle);
    if (digest !== operation.baselineDigest) {
      await this.setTerminal(operation.id, ["queued", "validating", "prepared"], "conflict", "owned_field_baseline_conflict", now);
      return false;
    }
    const revisionId = canonicalDigest(`${operation.tenantId}:${operation.shopId}:${operation.listingId}:${digest}`);
    const results = await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO listing_revisions(id,tenant_id,shop_connection_id,listing_id,source_digest,title,fetched_at,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(revisionId, operation.tenantId, operation.shopId, operation.listingId, digest, observedTitle, now, now),
      this.db.prepare(`
        INSERT INTO listing_current(tenant_id,shop_connection_id,listing_id,revision_id,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(tenant_id,shop_connection_id,listing_id) DO UPDATE SET revision_id=excluded.revision_id,updated_at=excluded.updated_at
      `).bind(operation.tenantId, operation.shopId, operation.listingId, revisionId, now),
      this.db.prepare(`UPDATE operations SET state='prepared',prepared_at=?,prewrite_revision_id=?,last_observation_revision_id=?,version=version+1,updated_at=? WHERE id=? AND state IN ('queued','validating')`)
        .bind(now, revisionId, revisionId, now, operation.id),
    ]);
    return (results[2]?.meta.changes ?? 0) === 1;
  }

  async claimDispatch(operation: TitleOperation, now: string): Promise<boolean> {
    const utcDate = now.slice(0, 10);
    try {
      const results = await this.db.batch([
        this.db.prepare(`INSERT OR IGNORE INTO quota_daily(shop_connection_id,utc_date,writes_used,recovery_reads_used,updated_at) SELECT shop_connection_id,?,0,0,? FROM operations WHERE id=?`)
          .bind(utcDate, now, operation.id),
        this.db.prepare(`
          INSERT INTO quota_reservations(operation_id,shop_connection_id,utc_date,kind,created_at)
          SELECT o.id,o.shop_connection_id,?,'write',?
          FROM operations o
          JOIN commands c ON c.id=o.id
          JOIN tenants t ON t.id=o.tenant_id
          JOIN memberships m ON m.tenant_id=o.tenant_id AND m.actor_id=c.actor_id
          JOIN shop_connections s ON s.id=o.shop_connection_id AND s.tenant_id=o.tenant_id
          JOIN capability_grants g ON g.tenant_id=o.tenant_id AND g.shop_connection_id=o.shop_connection_id AND g.field='title'
          JOIN policies p ON p.shop_connection_id=o.shop_connection_id AND p.tenant_id=o.tenant_id
          JOIN quota_daily q ON q.shop_connection_id=o.shop_connection_id AND q.utc_date=?
          JOIN restore_state r ON r.singleton=1
          WHERE o.id=? AND o.state='prepared'
            AND m.active=1 AND m.role IN ('owner','editor')
            AND s.status='active' AND s.write_lane_state='open'
            AND t.authority_epoch=c.tenant_epoch
            AND s.authority_epoch=c.shop_epoch
            AND g.authority_epoch=c.capability_epoch
            AND c.approval_expires_at>?
            AND p.application_kill_switch=0 AND p.shop_kill_switch=0
            AND r.status IN ('normal','reconciled') AND r.egress_enabled=1
            AND EXISTS(SELECT 1 FROM json_each(s.scopes_json) WHERE value='listings_w')
            AND (g.mode='enabled' OR (g.mode='canary'
              AND g.canary_listing_id=c.listing_id
              AND g.canary_baseline_digest=c.baseline_digest
              AND g.canary_proposed_digest=c.proposed_digest
              AND g.canary_expires_at>?))
            AND p.daily_write_limit>0 AND q.writes_used<p.daily_write_limit
        `).bind(utcDate, now, utcDate, operation.id, now, now),
        this.db.prepare(`UPDATE quota_daily SET writes_used=writes_used+1,updated_at=? WHERE shop_connection_id=(SELECT shop_connection_id FROM quota_reservations WHERE operation_id=? AND kind='write') AND utc_date=?`)
          .bind(now, operation.id, utcDate),
        this.db.prepare(`INSERT INTO operation_attempts(id,operation_id,ordinal,marked_potentially_sent_at,result) SELECT ?,id,1,?,'pending' FROM operations WHERE id=? AND state='prepared' AND EXISTS(SELECT 1 FROM quota_reservations WHERE operation_id=? AND kind='write')`)
          .bind(`${operation.id}:attempt:1`, now, operation.id, operation.id),
        this.db.prepare(`UPDATE operations SET state='dispatching',dispatched_at=?,version=version+1,updated_at=? WHERE id=? AND state='prepared' AND EXISTS(SELECT 1 FROM operation_attempts WHERE operation_id=? AND ordinal=1)`)
          .bind(now, now, operation.id, operation.id),
      ]);
      return (results[1]?.meta.changes ?? 0) === 1 && (results[2]?.meta.changes ?? 0) === 1 && (results[3]?.meta.changes ?? 0) === 1 && (results[4]?.meta.changes ?? 0) === 1;
    } catch {
      return false;
    }
  }

  async recordAttemptResult(operationId: string, result: "response_received" | "transport_ambiguous", status: number | null, now: string): Promise<void> {
    await this.db.prepare(`UPDATE operation_attempts SET result=?,response_status=?,completed_at=? WHERE operation_id=? AND ordinal=1`)
      .bind(result, status, now, operationId).run();
  }

  async verify(operation: TitleOperation, observedTitle: string, kind: NonNullable<TitleOperation["verificationKind"]>, now: string): Promise<boolean> {
    if (canonicalDigest(observedTitle) !== operation.proposedDigest) return false;
    const result = await this.db.prepare(`UPDATE operations SET state='verified',verified_at=?,verification_kind=?,version=version+1,failure_code=NULL,updated_at=? WHERE id=? AND state IN ('dispatching','verifying','unknown')`)
      .bind(now, kind, now, operation.id).run();
    if ((result.meta.changes ?? 0) === 1) {
      await this.db.prepare(`UPDATE shop_connections SET write_lane_state='open',updated_at=? WHERE id=?`).bind(now, operation.shopId).run();
      await this.db.prepare(`UPDATE outbox SET state='done',updated_at=? WHERE operation_id=?`).bind(now, operation.id).run();
      return true;
    }
    return false;
  }

  async markUnknown(operation: TitleOperation, code: string, now: string): Promise<void> {
    const incidentId = crypto.randomUUID();
    await this.db.batch([
      this.db.prepare(`UPDATE operations SET state='unknown',failure_code=?,version=version+1,next_reconciliation_at=?,updated_at=? WHERE id=? AND state IN ('dispatching','verifying','unknown')`)
        .bind(code, now, now, operation.id),
      this.db.prepare(`UPDATE shop_connections SET write_lane_state='blocked',updated_at=? WHERE id=?`).bind(now, operation.shopId),
      this.db.prepare(`INSERT INTO incidents(id,tenant_id,shop_connection_id,operation_id,code,state,notification_state,created_at,updated_at) VALUES(?,?,?,?,?,'open','pending',?,?)`)
        .bind(incidentId, operation.tenantId, operation.shopId, operation.id, code, now, now),
    ]);
  }

  async incrementReconciliation(operationId: string, now: string): Promise<number> {
    const utcDate = now.slice(0, 10);
    const results = await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO quota_daily(shop_connection_id,utc_date,writes_used,recovery_reads_used,updated_at) SELECT shop_connection_id,?,0,0,? FROM operations WHERE id=?`)
        .bind(utcDate, now, operationId),
      this.db.prepare(`
        UPDATE quota_daily SET recovery_reads_used=recovery_reads_used+1,updated_at=?
        WHERE shop_connection_id=(SELECT shop_connection_id FROM operations WHERE id=?) AND utc_date=?
          AND recovery_reads_used<(SELECT recovery_read_reserve FROM policies p JOIN operations o ON o.shop_connection_id=p.shop_connection_id AND o.tenant_id=p.tenant_id WHERE o.id=?)
      `).bind(now, operationId, utcDate, operationId),
      this.db.prepare(`UPDATE operations SET reconciliation_reads=reconciliation_reads+1,updated_at=? WHERE id=? AND state IN ('dispatching','verifying','unknown')`)
        .bind(now, operationId),
    ]);
    if ((results[1]?.meta.changes ?? 0) !== 1) return 5;
    return (await this.getOperation(operationId)).reconciliationReads;
  }

  async requireManual(operation: TitleOperation, code: string, now: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(`UPDATE operations SET state='manual_required',failure_code=?,version=version+1,updated_at=? WHERE id=? AND state IN ('dispatching','verifying','unknown')`).bind(code, now, operation.id),
      this.db.prepare(`UPDATE shop_connections SET write_lane_state='blocked',updated_at=? WHERE id=?`).bind(now, operation.shopId),
    ]);
  }

  async recordNotification(operation: TitleOperation, sent: boolean, now: string): Promise<void> {
    const statements = [
      this.db.prepare(`UPDATE incidents SET notification_state=?,updated_at=? WHERE operation_id=? AND state='open' AND notification_state='pending'`)
        .bind(sent ? "sent" : "failed", now, operation.id),
    ];
    if (!sent) {
      statements.push(this.db.prepare(`UPDATE policies SET shop_kill_switch=1,updated_at=? WHERE tenant_id=? AND shop_connection_id=?`)
        .bind(now, operation.tenantId, operation.shopId));
    }
    await this.db.batch(statements);
  }

  async markOutboxStarted(operationId: string, now: string): Promise<void> {
    await this.db.prepare(`UPDATE outbox SET state='started',attempts=attempts+1,updated_at=? WHERE operation_id=? AND state IN ('pending','leased','started')`)
      .bind(now, operationId).run();
  }

  async setTerminal(id: string, from: TitleOperation["state"][], to: "conflict" | "cancelled_before_dispatch" | "rejected", code: string, now: string): Promise<void> {
    const placeholders = from.map(() => "?").join(",");
    await this.db.prepare(`UPDATE operations SET state=?,failure_code=?,version=version+1,updated_at=? WHERE id=? AND state IN (${placeholders})`)
      .bind(to, code, now, id, ...from).run();
  }

  private auditStatement(operation: TitleOperation, eventType: string, now: string): D1PreparedStatement {
    return this.db.prepare(`
      INSERT INTO audit_events(id,tenant_id,shop_connection_id,actor_id,operation_id,event_type,redacted_payload_json,created_at)
      SELECT ?,tenant_id,shop_connection_id,actor_id,id,?,?,? FROM commands WHERE id=?
    `).bind(crypto.randomUUID(), eventType, JSON.stringify({ listing_id: operation.listingId, request_digest: operation.requestDigest }), now, operation.id);
  }
}
