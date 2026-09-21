import type { OperationAttempt, TitleOperation } from "./types.ts";

export class InMemoryOperationStore {
  readonly operations = new Map<string, TitleOperation>();
  readonly idempotency = new Map<string, string>();
  readonly attempts = new Map<string, OperationAttempt>();
  readonly outbox: string[] = [];
  readonly incidents: Array<{ operationId: string; code: string }> = [];
  readonly blockedShops = new Set<string>();
  failAcceptBeforeCommit = false;
  failVerificationOnce = false;
  notificationsReachable = true;
  unattendedExposureSuspended = false;

  idempotencyScope(operation: Pick<TitleOperation, "tenantId" | "shopId" | "idempotencyKey">): string {
    return `${operation.tenantId}:${operation.shopId}:${operation.idempotencyKey}`;
  }

  accept(operation: TitleOperation): TitleOperation {
    const scope = this.idempotencyScope(operation);
    const existingId = this.idempotency.get(scope);
    if (existingId) {
      const existing = this.operations.get(existingId);
      if (!existing) throw new Error("store_invariant_missing_operation");
      if (existing.requestDigest !== operation.requestDigest) throw new Error("idempotency_conflict");
      return existing;
    }
    if (this.failAcceptBeforeCommit) throw new Error("acceptance_transaction_failed");
    if (this.blockedShops.has(operation.shopId)) throw new Error("shop_lane_blocked");
    this.operations.set(operation.id, operation);
    this.idempotency.set(scope, operation.id);
    this.outbox.push(operation.id);
    return operation;
  }

  get(id: string): TitleOperation {
    const operation = this.operations.get(id);
    if (!operation) throw new Error("operation_not_found");
    return operation;
  }

  transition(id: string, expected: TitleOperation["state"][], next: TitleOperation["state"]): TitleOperation {
    const operation = this.get(id);
    if (!expected.includes(operation.state)) throw new Error(`invalid_transition:${operation.state}:${next}`);
    operation.state = next;
    operation.version += 1;
    if (["unknown", "manual_required"].includes(next)) this.blockedShops.add(operation.shopId);
    if (next === "verified" || next === "rejected" || next === "cancelled_before_dispatch" || next === "conflict") {
      this.blockedShops.delete(operation.shopId);
    }
    return operation;
  }

  recordAttempt(operation: TitleOperation, now: string): OperationAttempt {
    const existing = this.attempts.get(operation.id);
    if (existing) return existing;
    const attempt: OperationAttempt = {
      id: `${operation.id}:attempt:1`,
      operationId: operation.id,
      markedPotentiallySentAt: now,
      result: "pending",
    };
    this.attempts.set(operation.id, attempt);
    return attempt;
  }

  incident(operationId: string, code: string): void {
    this.incidents.push({ operationId, code });
    if (!this.notificationsReachable) this.unattendedExposureSuspended = true;
  }
}
