# ADR 0002: Durable, non-replaying title mutation foundation

## Status

Accepted for the Phase 3 implementation. Production enablement remains gated by G3a and H3.

## Context

Phase 3 must coordinate authenticated, tenant-scoped Etsy writes across request retries, Worker restarts, lost responses, revocation, external owner edits, and restored backups. Etsy's listing PATCH does not provide a verified remote compare-and-set primitive. A process cannot prove whether an external request crossed the network when it crashes after recording intent.

The previous application kept mutable JSON state beside side effects and could not make its lifecycle or recovery authoritative. The replacement must preserve ambiguity instead of retrying it away.

## Decision

- D1 is authoritative for membership, shop identity, authority epochs, capability grants, commands, outbox records, operation state, attempts, quotas, incidents, and audit events.
- Etsy is authoritative for current listing state. Every dispatch and keep/revert decision performs a fresh read.
- One Durable Object per tenant/shop schedules a unique Workflow instance for each accepted operation. D1 remains the business-state authority; the Durable Object is only a coordination atom.
- The Workflow uses a conditional D1 dispatch claim that records the sole attempt as potentially sent before network I/O. A resumed step that sees an attempt never sends the PATCH again; it performs bounded reads and converges to verified, conflict, or manual-required.
- The first writable adapter owns exactly one complete title string. It issues a PATCH body containing only `title`. Revert is a new approved operation and is accepted only against the last verified experiment title.
- Credentials are immutable AES-256-GCM versions with tenant/shop/version associated data. OAuth uses PKCE and binds state to the authenticated owner, tenant, expected Etsy shop, redirect URI, and expiry.
- Fresh/restored databases, new connections, capability grants, shop policies, and Wrangler configuration all default to write-disabled. A restore invalidates authority, pauses lanes, overlays the append-only deletion journal, and still requires a separate operator action before egress.
- R2 stores content-addressed recovery manifests and append-only deletion tombstones; it is never an authorization source.
- Clerk authenticates identity. D1 membership and authority decide tenancy and permissions on every command.

## Alternatives considered

- **Retry PATCH after timeout:** rejected because a committed response can be lost and replay would create an unapproved second mutation attempt.
- **Treat the Durable Object as the operation database:** rejected because D1 already owns cross-shop policy, audit, recovery, and operator queries. Duplicating business truth would create reconciliation problems.
- **Single synchronous request lifecycle:** rejected because verification and bounded reconciliation must survive client disconnects and Worker restarts.
- **Full-listing snapshots and restore:** rejected because they overwrite unrelated Etsy or owner changes. The executor owns one field.
- **Enable writes immediately after deployment:** rejected because deployed simulator, notification, restore, and exact live-canary evidence are required to raise a capability from T0/T2 to T3.

## Consequences

The system prefers a blocked lane and owner intervention over duplicate or falsely completed writes. Some provably unsent requests may still become `unknown` after a crash because safety takes priority over automatic liveness. D1, Workflows, Durable Objects, R2, Clerk, Resend, and encrypted credential operations become operational dependencies. Each later field needs its own preservation and recovery contract; the title executor must not become a generic snapshot restorer.

## Validation and revisit conditions

Revisit only if Etsy introduces a documented conditional-write/idempotency primitive or deployed evidence disproves a platform assumption. G3a must execute F01–F15 against a deployed strict simulator and isolated restore. H3 must then demonstrate the exact owner-authorized title canary, conflict preservation, lost-response reconciliation, notification receipt, and recovery before title writes are generally enabled.
