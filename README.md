# Auto Etsy SEO

Auto Etsy SEO is being rebuilt as a gated, independent Etsy listing experiment
product. The authoritative implementation source is identified by
`docs/rebuild/plan-source.json`.

## Current state

Phase 0 is complete for the owner's narrowly approved read-only scope. Phase 1
is in progress: it provides a strict new Etsy read adapter, sanitized disposable
validation storage, deterministic source-contract tests, and a private
reconciliation report. The v1 Etsy/OpenAI runtime remains quarantined.

The only live capability is bounded Phase 1 validation for the owner's shop as
recorded in the signed, ignored G0 evidence. Nothing enables Etsy writes, AI
processing, invited shops, randomized experiments, or production deployment.

Run the safe gate locally:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 validation/phase0/validate_phase0.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s validation -p 'test_*.py' -v
```

## Legacy runtime

The former Flask/React implementation is preserved at Git tag
`legacy-v1-2026-09-20` for audit and recovery. Its server, manual scripts, Etsy
client, and OpenAI client are intentionally non-executable on this rebuild
branch. Do not use old launch commands or live-write scripts as regression
tests.

Legacy ignored data and credentials remain local. They are not new-system
fixtures, do not establish current Etsy state, and must not be committed or
placed in an unencrypted shared archive.

## Phase 1 probe

The live probe reads the active listing catalog and a bounded recent receipt
window, strips buyer data before persistence, and writes only to ignored local
evidence. It never refreshes or rewrites credentials; an expired grant is an
explicit blocker.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m validation.phase1.run_phase1_probe
```

G1 remains open until the seven-day view diagnostic and H1 owner comparison
are complete. Current endpoint and field dispositions are in
`docs/rebuild/phase1-source-contracts.md`.
