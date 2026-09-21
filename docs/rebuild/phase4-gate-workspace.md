# Phase 4 gate workspace

Phase 4 turns the Phase 1–3 evidence into a human-readable owner workflow. It
does not weaken or replace the gates. The server owns every protocol, evidence
revision, dependency check, and approval record; the browser only records the
owner's comparison or observation.

## Gate 1 — trust the data

The owner starts one sanitized collection. Read egress is a separate runtime
switch and defaults off. Collection requires an active owner membership and
`listings_r`, `transactions_r`, and `shops_r`; reserves a non-refundable
12-request daily UTC budget before network I/O; refuses pagination beyond three
100-item pages per source; follows no redirects; and persists no buyer names,
addresses, descriptions, or personalization.

The deterministic packet samples listing view extremes and state diversity,
plus receipts likely to expose multi-line, multi-quantity, refund, or
cancellation mistakes. Each response is append-only and bound to the packet's
evidence revision. A new collection supersedes the old run and invalidates its
responses. Transaction units are the only initially eligible outcome metric;
views and refund-adjusted money remain disabled until their separate evidence
is complete.

Optional screenshots, PDFs, and JSON evidence are streamed to private R2 with a
10 MB limit, media allowlist, and browser/server SHA-256 agreement. Buyer data
should never be uploaded.

## Gate 2 — interpret results honestly

After G1 approval, the server creates the six-part H2 protocol bound to A2's
immutable release-results artifact. The owner acknowledges exact-enumeration resolution,
power, weighting, directional before/after limits, heterogeneous-effect
interpretation, and the current shop route. Approval records the
`directional_only` disposition. Randomized inference and automatic winner
decisions remain disabled.

## Gate 3 — prove changes fail safely

After G1 and G2 approval, the server prepares F01–F15 and the nine H3 human
steps. The tracked local A3 result is explicitly insufficient: the run starts
with automated evidence failed until the suite is exercised through deployed
Worker, D1, Durable Object, Workflow, R2, authentication, and notification
boundaries. H3 observations require a separately authorized exact title canary.
The UI can record observations, but it cannot turn local evidence into a
deployed pass or enable a write capability.

Even after G3, the intended boundary is owner-operated title T3 only. Tags,
general Etsy egress, AI execution, randomized experiments, and automation stay
disabled.

## Local verification

These commands match CI and use no credentials or live network calls:

```bash
npm ci --ignore-scripts
python3 -m pip install --disable-pip-version-check -r validation/requirements.txt
npm run cf:types
npm run typecheck:phase2 && npm run test:phase2
npm run typecheck:phase3 && npm run test:phase3
npm run typecheck:phase4 && npm run test:phase4
npx tsc -p apps/web/tsconfig.json --noEmit
npm run build:web
npm run db:migrate:local
npm run cf:dry-run
python3 -m unittest discover -s validation -p 'test_*.py' -v
python3 validation/phase0/validate_phase0.py
python3 validation/phase1/validate_phase1.py
python3 validation/phase2/validate_phase2.py
python3 validation/phase3/validate_phase3.py
python3 validation/phase4/validate_phase4.py
```
