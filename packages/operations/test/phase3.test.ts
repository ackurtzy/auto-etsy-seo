import assert from "node:assert/strict";
import test from "node:test";

import {
  FakeEtsyTitleService,
  InMemoryOperationStore,
  Phase3Executor,
  acceptTitleCommand,
  canonicalDigest,
  validateTitle,
  type AuthoritySnapshot,
  type TitleCommandInput,
} from "../src/index.ts";

const NOW = "2026-09-21T02:30:00.000Z";

function authority(overrides: Partial<AuthoritySnapshot> = {}): AuthoritySnapshot {
  return {
    actorActive: true,
    actorRole: "owner",
    tenantEpoch: 2,
    shopEpoch: 4,
    capabilityEpoch: 3,
    capabilityMode: "canary",
    applicationKillSwitch: false,
    shopKillSwitch: false,
    scopes: ["listings_r", "listings_w"],
    canary: {
      gateId: "G3-canary-title",
      listingId: "1001",
      baselineDigest: canonicalDigest("Original truthful title"),
      proposedDigest: canonicalDigest("Approved truthful title"),
      expiresAt: "2026-09-22T02:30:00.000Z",
    },
    ...overrides,
  };
}

function input(overrides: Partial<TitleCommandInput> = {}): TitleCommandInput {
  return {
    id: "op-1",
    idempotencyKey: "idem-1",
    tenantId: "tenant-1",
    shopId: "shop-1",
    listingId: "1001",
    actorId: "user-1",
    baselineTitle: "Original truthful title",
    proposedTitle: "Approved truthful title",
    authority: { tenantEpoch: 2, shopEpoch: 4, capabilityEpoch: 3 },
    approvalExpiresAt: "2026-09-22T02:30:00.000Z",
    ...overrides,
  };
}

test("title validation follows the frozen title capability contract", () => {
  assert.equal(validateTitle("Accented café — stationery").ok, true);
  assert.equal(validateTitle("").ok, false);
  assert.equal(validateTitle("x".repeat(141)).ok, false);
  assert.equal(validateTitle("bad\ncontrol").ok, false);
  assert.equal(validateTitle("50% & 40% off").ok, false);
});

test("same idempotency key and digest converges; a different digest conflicts", () => {
  const store = new InMemoryOperationStore();
  const enabled = authority({ capabilityMode: "enabled" });
  const first = acceptTitleCommand(store, input(), enabled, NOW);
  const duplicate = acceptTitleCommand(store, input(), enabled, NOW);
  assert.equal(duplicate.operation.id, first.operation.id);
  assert.equal(store.operations.size, 1);
  assert.throws(
    () => acceptTitleCommand(store, input({ proposedTitle: "Different accurate title" }), enabled, NOW),
    /idempotency_conflict/,
  );
});

test("stale, revoked, disabled, expired, or nonallowlisted authority rejects before outbox", () => {
  const cases: AuthoritySnapshot[] = [
    authority({ actorActive: false }),
    authority({ actorRole: "viewer" }),
    authority({ capabilityMode: "disabled" }),
    authority({ tenantEpoch: 99 }),
    authority({ scopes: ["listings_r"] }),
    authority({ applicationKillSwitch: true }),
    authority({ canary: { ...authority().canary!, listingId: "other" } }),
    authority({ canary: { ...authority().canary!, expiresAt: "2026-09-20T00:00:00.000Z" } }),
  ];
  for (const [index, snapshot] of cases.entries()) {
    const store = new InMemoryOperationStore();
    assert.throws(() => acceptTitleCommand(store, input({ id: `op-${index}` }), snapshot, NOW));
    assert.equal(store.operations.size, 0);
    assert.equal(store.outbox.length, 0);
  }
});

test("verified title mutation changes only title and dispatches once", async () => {
  const store = new InMemoryOperationStore();
  const etsy = new FakeEtsyTitleService({
    listingId: "1001",
    title: "Original truthful title",
    description: "Owner description",
    tags: ["one", "two"],
  });
  const executor = new Phase3Executor(store, etsy, () => authority(), () => NOW);
  acceptTitleCommand(store, input(), authority(), NOW);
  const result = await executor.run("op-1");
  assert.equal(result.state, "verified");
  assert.equal(etsy.mutationCount, 1);
  assert.equal(etsy.listing.description, "Owner description");
  assert.deepEqual(etsy.listing.tags, ["one", "two"]);
});

test("lost response is reconciled by reads and never replays mutation", async () => {
  const store = new InMemoryOperationStore();
  const etsy = new FakeEtsyTitleService({ listingId: "1001", title: "Original truthful title" });
  etsy.failures.loseResponseAfterCommit = true;
  const executor = new Phase3Executor(store, etsy, () => authority(), () => NOW);
  acceptTitleCommand(store, input(), authority(), NOW);
  const first = await executor.run("op-1");
  assert.equal(first.state, "unknown");
  assert.equal(etsy.mutationCount, 1);
  const reconciled = await executor.reconcile("op-1");
  assert.equal(reconciled.state, "verified");
  assert.equal(reconciled.verificationKind, "verified_observed_desired_state");
  assert.equal(etsy.mutationCount, 1);
});

test("owned-field drift conflicts while unrelated edits survive conditional revert", async () => {
  const store = new InMemoryOperationStore();
  const etsy = new FakeEtsyTitleService({
    listingId: "1001",
    title: "Original truthful title",
    description: "Before",
  });
  const executor = new Phase3Executor(store, etsy, () => authority({ capabilityMode: "enabled" }), () => NOW);
  acceptTitleCommand(store, input(), authority({ capabilityMode: "enabled" }), NOW);
  await executor.run("op-1");
  etsy.ownerEdit({ description: "After owner edit" });
  const reverted = await executor.revert("op-1", "revert-1", "idem-revert");
  assert.equal(reverted.state, "verified");
  assert.equal(etsy.listing.title, "Original truthful title");
  assert.equal(etsy.listing.description, "After owner edit");

  etsy.ownerEdit({ title: "Owner chose a third title" });
  const conflict = await executor.revert("op-1", "revert-2", "idem-revert-2");
  assert.equal(conflict.state, "conflict");
  assert.equal(etsy.listing.title, "Owner chose a third title");
});

test("keep performs a fresh read and never writes", async () => {
  const store = new InMemoryOperationStore();
  const etsy = new FakeEtsyTitleService({ listingId: "1001", title: "Original truthful title" });
  const executor = new Phase3Executor(store, etsy, () => authority(), () => NOW);
  acceptTitleCommand(store, input(), authority(), NOW);
  await executor.run("op-1");
  const mutationsBeforeKeep = etsy.mutationCount;
  const readsBeforeKeep = etsy.readCount;
  const kept = await executor.keep("op-1");
  assert.equal(kept.state, "verified");
  assert.equal(etsy.mutationCount, mutationsBeforeKeep);
  assert.equal(etsy.readCount, readsBeforeKeep + 1);
});

test("F01-F15 fault matrix has explicit fail-closed outcomes", async () => {
  const outcomes = await Phase3Executor.runFaultMatrix();
  assert.equal(outcomes.length, 15);
  assert.deepEqual(outcomes.map((row) => row.id), Array.from({ length: 15 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`));
  for (const outcome of outcomes) {
    assert.equal(outcome.passed, true, `${outcome.id}: ${outcome.detail}`);
  }
});
