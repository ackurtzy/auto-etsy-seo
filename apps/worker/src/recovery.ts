import { canonicalDigest } from "../../../packages/operations/src/index.ts";
import type { AppEnv } from "./env.ts";

export interface BackupManifestInput {
  id: string;
  environment: string;
  d1BackupReference: string;
  schemaVersion: string;
  executorVersion: string;
  tombstoneWatermark: string;
  referencedR2Keys: string[];
  createdAt: string;
}

export class RecoveryService {
  constructor(private readonly env: AppEnv) {}

  async recordDeletionTombstone(input: { id: string; tenantId: string; shopConnectionId?: string; recordedAt: string }): Promise<string> {
    const key = `recovery-journal/deletions/${input.recordedAt.slice(0, 10)}/${input.id}.json`;
    const body = JSON.stringify({ schema_version: "deletion-tombstone-v1", ...input });
    await this.env.RECOVERY_BUCKET.put(key, body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: canonicalDigest(body) },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    try {
      await this.env.DB.prepare(`INSERT INTO deletion_tombstones(id,tenant_id,shop_connection_id,recovery_journal_key,recorded_at) VALUES(?,?,?,?,?)`)
        .bind(input.id, input.tenantId, input.shopConnectionId ?? null, key, input.recordedAt).run();
    } catch (error) {
      await this.env.RECOVERY_BUCKET.delete(key);
      throw error;
    }
    return key;
  }

  async recordBackupManifest(input: BackupManifestInput): Promise<string> {
    const sorted = { ...input, referencedR2Keys: [...input.referencedR2Keys].sort() };
    const body = JSON.stringify({ schema_version: "phase3-backup-manifest-v1", ...sorted });
    const digest = canonicalDigest(body);
    const key = `backups/${input.createdAt.slice(0, 10)}/${input.id}/manifest.json`;
    await this.env.RECOVERY_BUCKET.put(key, body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: digest },
      onlyIf: { etagDoesNotMatch: "*" },
    });
    await this.env.DB.prepare(`
      INSERT INTO backup_manifests(id,environment,d1_backup_reference,r2_manifest_key,schema_version,executor_version,tombstone_watermark,content_sha256,state,created_at)
      VALUES(?,?,?,?,?,?,?,?, 'prepared', ?)
    `).bind(input.id, input.environment, input.d1BackupReference, key, input.schemaVersion, input.executorVersion, input.tombstoneWatermark, digest, input.createdAt).run();
    return key;
  }

  async beginIsolatedRestore(backupId: string, now: string): Promise<void> {
    await this.env.DB.batch([
      this.env.DB.prepare(`UPDATE restore_state SET status='quarantined',egress_enabled=0,source_backup_id=?,tombstone_overlay_at=NULL,updated_at=? WHERE singleton=1`)
        .bind(backupId, now),
      this.env.DB.prepare(`UPDATE shop_connections SET write_lane_state='paused',authority_epoch=authority_epoch+1,updated_at=?`).bind(now),
      this.env.DB.prepare(`UPDATE operations SET state='manual_required',failure_code='restored_operation_paused',version=version+1,updated_at=? WHERE state IN ('queued','validating','prepared','dispatching','verifying','unknown')`).bind(now),
    ]);
  }

  async markTombstoneOverlayComplete(watermark: string, now: string): Promise<void> {
    const manifest = await this.env.DB.prepare(`SELECT tombstone_watermark FROM backup_manifests WHERE id=(SELECT source_backup_id FROM restore_state WHERE singleton=1)`).first<{ tombstone_watermark: string }>();
    if (!manifest || watermark < manifest.tombstone_watermark) throw new Error("tombstone_watermark_incomplete");
    await this.env.DB.prepare(`UPDATE restore_state SET status='reconciled',egress_enabled=0,tombstone_overlay_at=?,updated_at=? WHERE singleton=1 AND status='quarantined'`)
      .bind(now, now).run();
  }
}
