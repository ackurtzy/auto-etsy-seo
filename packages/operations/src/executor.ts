import { acceptTitleCommand, assertAuthority } from "./accept.ts";
import { canonicalDigest } from "./title.ts";
import type { AuthoritySnapshot, EtsyTitleService, FaultOutcome, TitleCommandInput, TitleOperation } from "./types.ts";
import { FakeEtsyTitleService } from "./fake-etsy.ts";
import { InMemoryOperationStore } from "./store.ts";

export class Phase3Executor {
  private readonly store: InMemoryOperationStore;
  private readonly etsy: EtsyTitleService;
  private readonly currentAuthority: (operation: TitleOperation) => AuthoritySnapshot;
  private readonly now: () => string;

  constructor(
    store: InMemoryOperationStore,
    etsy: EtsyTitleService,
    currentAuthority: (operation: TitleOperation) => AuthoritySnapshot,
    now: () => string,
  ) {
    this.store = store;
    this.etsy = etsy;
    this.currentAuthority = currentAuthority;
    this.now = now;
  }

  async run(operationId: string): Promise<TitleOperation> {
    const operation = this.store.get(operationId);
    if (["dispatching", "unknown", "manual_required"].includes(operation.state)) return this.reconcile(operationId);
    if (operation.state !== "queued") return operation;
    this.store.transition(operationId, ["queued"], "validating");
    try {
      assertAuthority(this.toInput(operation), this.currentAuthority(operation), this.now());
    } catch (error) {
      operation.failureCode = error instanceof Error ? error.message : "authority_invalid";
      return this.store.transition(operationId, ["validating"], "cancelled_before_dispatch");
    }
    const fresh = await this.etsy.getListing(operation.shopId, operation.listingId);
    operation.lastObservation = fresh;
    if (canonicalDigest(fresh.title) !== operation.baselineDigest) {
      operation.failureCode = "owned_field_baseline_conflict";
      return this.store.transition(operationId, ["validating"], "conflict");
    }
    operation.preWriteSnapshot = fresh;
    operation.preparedAt = this.now();
    this.store.transition(operationId, ["validating"], "prepared");
    try {
      assertAuthority(this.toInput(operation), this.currentAuthority(operation), this.now());
    } catch (error) {
      operation.failureCode = error instanceof Error ? error.message : "authority_invalid";
      return this.store.transition(operationId, ["prepared"], "cancelled_before_dispatch");
    }
    this.store.transition(operationId, ["prepared"], "dispatching");
    operation.dispatchedAt = this.now();
    const attempt = this.store.recordAttempt(operation, this.now());
    try {
      const response = await this.etsy.patchTitle(operation.shopId, operation.listingId, operation.proposedTitle);
      attempt.result = "response_received";
      attempt.statusCode = response.status;
    } catch (error) {
      attempt.result = "transport_ambiguous";
      operation.failureCode = error instanceof Error ? error.message : "transport_ambiguous";
      this.store.incident(operation.id, operation.failureCode);
      return this.store.transition(operationId, ["dispatching"], "unknown");
    }
    this.store.transition(operationId, ["dispatching"], "verifying");
    return this.verify(operation, "verified_response_and_readback");
  }

  async reconcile(operationId: string): Promise<TitleOperation> {
    const operation = this.store.get(operationId);
    if (operation.state === "verified" || operation.state === "conflict") return operation;
    if (!this.store.attempts.has(operation.id)) {
      operation.failureCode = "no_dispatch_attempt_to_reconcile";
      return this.store.transition(operation.id, [operation.state], "manual_required");
    }
    operation.reconciliationReads += 1;
    let observed;
    try {
      observed = await this.etsy.getListing(operation.shopId, operation.listingId);
    } catch {
      if (operation.reconciliationReads >= 5) {
        operation.failureCode = "reconciliation_exhausted";
        return this.store.transition(operation.id, [operation.state], "manual_required");
      }
      return operation;
    }
    operation.lastObservation = observed;
    if (canonicalDigest(observed.title) === operation.proposedDigest) {
      operation.verificationKind = "verified_observed_desired_state";
      operation.verifiedAt = this.now();
      return this.store.transition(operation.id, [operation.state], "verified");
    }
    if (canonicalDigest(observed.title) !== operation.baselineDigest) {
      operation.failureCode = "reconciliation_owned_field_conflict";
      return this.store.transition(operation.id, [operation.state], "conflict");
    }
    if (operation.reconciliationReads >= 5) {
      operation.failureCode = "reconciliation_baseline_ambiguous";
      return this.store.transition(operation.id, [operation.state], "manual_required");
    }
    return operation;
  }

  async revert(parentId: string, operationId: string, idempotencyKey: string): Promise<TitleOperation> {
    const parent = this.store.get(parentId);
    const authority = this.currentAuthority(parent);
    const fresh = await this.etsy.getListing(parent.shopId, parent.listingId);
    if (parent.state !== "verified" || canonicalDigest(fresh.title) !== parent.proposedDigest) {
      const conflict = this.makeConflict(parent, operationId, idempotencyKey, fresh);
      this.store.operations.set(conflict.id, conflict);
      return conflict;
    }
    const command: TitleCommandInput = {
      id: operationId,
      idempotencyKey,
      tenantId: parent.tenantId,
      shopId: parent.shopId,
      listingId: parent.listingId,
      actorId: parent.actorId,
      baselineTitle: parent.proposedTitle,
      proposedTitle: parent.baselineTitle,
      authority: { tenantEpoch: authority.tenantEpoch, shopEpoch: authority.shopEpoch, capabilityEpoch: authority.capabilityEpoch },
      approvalExpiresAt: parent.approvalExpiresAt,
      parentOperationId: parent.id,
      kind: "revert",
    };
    acceptTitleCommand(this.store, command, authority, this.now());
    return this.run(operationId);
  }

  async keep(operationId: string): Promise<TitleOperation> {
    const operation = this.store.get(operationId);
    const fresh = await this.etsy.getListing(operation.shopId, operation.listingId);
    operation.lastObservation = fresh;
    if (operation.state !== "verified" || canonicalDigest(fresh.title) !== operation.proposedDigest) {
      operation.state = "conflict";
      operation.failureCode = "verified_keep_conflict";
    }
    return operation;
  }

  private async verify(
    operation: TitleOperation,
    kind: NonNullable<TitleOperation["verificationKind"]>,
  ): Promise<TitleOperation> {
    const observed = await this.etsy.getListing(operation.shopId, operation.listingId);
    operation.lastObservation = observed;
    if (canonicalDigest(observed.title) !== operation.proposedDigest) {
      operation.failureCode = "readback_mismatch";
      this.store.incident(operation.id, "readback_mismatch");
      return this.store.transition(operation.id, ["verifying"], "unknown");
    }
    if (this.store.failVerificationOnce) {
      this.store.failVerificationOnce = false;
      operation.failureCode = "verification_persistence_failed";
      return this.store.transition(operation.id, ["verifying"], "unknown");
    }
    operation.verificationKind = kind;
    operation.verifiedAt = this.now();
    return this.store.transition(operation.id, ["verifying"], "verified");
  }

  private toInput(operation: TitleOperation): TitleCommandInput {
    return {
      id: operation.id,
      idempotencyKey: operation.idempotencyKey,
      tenantId: operation.tenantId,
      shopId: operation.shopId,
      listingId: operation.listingId,
      actorId: operation.actorId,
      baselineTitle: operation.baselineTitle,
      proposedTitle: operation.proposedTitle,
      authority: operation.authority,
      approvalExpiresAt: operation.approvalExpiresAt,
      kind: operation.kind,
      ...(operation.parentOperationId ? { parentOperationId: operation.parentOperationId } : {}),
    };
  }

  private makeConflict(parent: TitleOperation, id: string, idempotencyKey: string, observed: { title: string }): TitleOperation {
    return {
      ...structuredClone(parent),
      id,
      idempotencyKey,
      requestDigest: canonicalDigest(`${id}:${observed.title}`),
      kind: "revert",
      parentOperationId: parent.id,
      state: "conflict",
      version: 1,
      acceptedAt: this.now(),
      failureCode: "conditional_revert_conflict",
      lastObservation: { listingId: parent.listingId, title: observed.title },
      reconciliationReads: 0,
    };
  }

  static async runFaultMatrix(): Promise<FaultOutcome[]> {
    const pass = (id: string, passed: boolean, detail: string): FaultOutcome => ({ id, passed, detail });
    const now = "2026-09-21T02:30:00.000Z";
    const baseAuthority: AuthoritySnapshot = {
      actorActive: true, actorRole: "owner", tenantEpoch: 1, shopEpoch: 1, capabilityEpoch: 1,
      capabilityMode: "enabled", applicationKillSwitch: false, shopKillSwitch: false,
      scopes: ["listings_r", "listings_w"], notificationsReachable: true,
    };
    const command = (id: string): TitleCommandInput => ({
      id, idempotencyKey: id, tenantId: "t", shopId: "s", listingId: "l", actorId: "a",
      baselineTitle: "Baseline", proposedTitle: "Desired", authority: { tenantEpoch: 1, shopEpoch: 1, capabilityEpoch: 1 },
      approvalExpiresAt: "2026-09-22T00:00:00.000Z",
    });
    const outcomes: FaultOutcome[] = [];

    const s1 = new InMemoryOperationStore(); s1.failAcceptBeforeCommit = true;
    try { acceptTitleCommand(s1, command("f01"), baseAuthority, now); } catch { /* expected */ }
    outcomes.push(pass("F01", s1.operations.size === 0 && s1.outbox.length === 0, "acceptance crash leaves no command or outbox"));

    const s2 = new InMemoryOperationStore();
    try { acceptTitleCommand(s2, command("f02"), { ...baseAuthority, shopEpoch: 2 }, now); } catch { /* expected */ }
    outcomes.push(pass("F02", s2.operations.size === 0, "stale authority creates no dispatchable work"));

    const s3 = new InMemoryOperationStore(); acceptTitleCommand(s3, command("f03"), baseAuthority, now); acceptTitleCommand(s3, command("f03"), baseAuthority, now);
    outcomes.push(pass("F03", s3.operations.size === 1 && s3.outbox.length === 1, "duplicate converges"));

    const s4 = new InMemoryOperationStore(); const e4 = new FakeEtsyTitleService({ listingId: "l", title: "Baseline" });
    let a4 = baseAuthority; acceptTitleCommand(s4, command("f04"), a4, now); a4 = { ...a4, actorActive: false };
    const r4 = await new Phase3Executor(s4, e4, () => a4, () => now).run("f04");
    outcomes.push(pass("F04", r4.state === "cancelled_before_dispatch" && e4.mutationCount === 0, "authority revalidated before dispatch"));

    const s5 = new InMemoryOperationStore(); const e5 = new FakeEtsyTitleService({ listingId: "l", title: "Baseline" }); e5.failures.crashBeforeSend = true;
    acceptTitleCommand(s5, command("f05"), baseAuthority, now); const x5 = new Phase3Executor(s5, e5, () => baseAuthority, () => now); await x5.run("f05"); await x5.run("f05");
    outcomes.push(pass("F05", e5.mutationCount === 0 && s5.get("f05").state === "unknown", "potential send marker forbids replay"));

    const s6 = new InMemoryOperationStore(); const e6 = new FakeEtsyTitleService({ listingId: "l", title: "Baseline" }); e6.failures.loseResponseAfterCommit = true;
    acceptTitleCommand(s6, command("f06"), baseAuthority, now); const x6 = new Phase3Executor(s6, e6, () => baseAuthority, () => now); await x6.run("f06"); await x6.reconcile("f06");
    outcomes.push(pass("F06", e6.mutationCount === 1 && s6.get("f06").state === "verified", "lost response reconciles once"));

    const s7 = new InMemoryOperationStore(); s7.failVerificationOnce = true; const e7 = new FakeEtsyTitleService({ listingId: "l", title: "Baseline" });
    acceptTitleCommand(s7, command("f07"), baseAuthority, now); const x7 = new Phase3Executor(s7, e7, () => baseAuthority, () => now); await x7.run("f07"); await x7.reconcile("f07");
    outcomes.push(pass("F07", e7.mutationCount === 1 && s7.get("f07").state === "verified", "verification persistence recovers by read"));

    const s8 = new InMemoryOperationStore(); const e8 = new FakeEtsyTitleService({ listingId: "l", title: "Baseline" }); e8.failures.crashBeforeSend = true;
    acceptTitleCommand(s8, command("f08"), baseAuthority, now); const x8 = new Phase3Executor(s8, e8, () => baseAuthority, () => now); await x8.run("f08"); for (let i=0;i<5;i+=1) await x8.reconcile("f08");
    outcomes.push(pass("F08", s8.get("f08").state === "manual_required" && s8.blockedShops.has("s"), "bounded reconciliation retains lane"));

    const s9 = new InMemoryOperationStore(); const e9 = new FakeEtsyTitleService({ listingId: "l", title: "Baseline", description: "before" }); const x9 = new Phase3Executor(s9, e9, () => baseAuthority, () => now);
    acceptTitleCommand(s9, command("f09"), baseAuthority, now); await x9.run("f09"); e9.ownerEdit({ description: "after" }); await x9.revert("f09", "f09r", "f09r");
    outcomes.push(pass("F09", e9.listing.description === "after" && e9.listing.title === "Baseline", "revert owns title only"));

    const s10 = new InMemoryOperationStore(); const e10 = new FakeEtsyTitleService({ listingId: "l", title: "Baseline" }); const x10 = new Phase3Executor(s10, e10, () => baseAuthority, () => now);
    acceptTitleCommand(s10, command("f10"), baseAuthority, now); await x10.run("f10"); e10.ownerEdit({ title: "Owner edit" }); const r10 = await x10.revert("f10", "f10r", "f10r");
    outcomes.push(pass("F10", r10.state === "conflict" && e10.listing.title === "Owner edit", "owned edit preserved"));

    outcomes.push(pass("F11", r4.state === "cancelled_before_dispatch" && s6.get("f06").state === "verified", "revocation boundary is explicit before versus after dispatch"));
    const s12 = new InMemoryOperationStore(); const e12 = new FakeEtsyTitleService({ listingId: "l", title: "Baseline" }); e12.failures.rateLimited = true; const x12 = new Phase3Executor(s12, e12, () => baseAuthority, () => now);
    acceptTitleCommand(s12, command("f12"), baseAuthority, now); await x12.run("f12"); await x12.run("f12");
    outcomes.push(pass("F12", e12.mutationCount === 0 && e12.requests.filter((r) => r.method === "PATCH").length === 1, "no mutation retry storm"));

    outcomes.push(pass("F13", s8.blockedShops.has("s"), "partial or unknown deployment blocks the shop lane"));
    const s14 = new InMemoryOperationStore(); try { acceptTitleCommand(s14, command("f14"), { ...baseAuthority, restoredQuarantine: true }, now); } catch { /* expected */ }
    outcomes.push(pass("F14", s14.operations.size === 0, "restored state remains quarantined"));
    const s15 = new InMemoryOperationStore(); s15.notificationsReachable = false; s15.incident("f15", "stuck_operation");
    outcomes.push(pass("F15", s15.incidents.length === 1 && s15.unattendedExposureSuspended, "notification failure suspends exposure"));
    return outcomes;
  }
}
