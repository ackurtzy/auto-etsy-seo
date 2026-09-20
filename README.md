# Auto Etsy SEO

Auto Etsy SEO is being rebuilt as a gated, independent Etsy listing experiment
product. The authoritative implementation source is identified by
`docs/rebuild/plan-source.json`.

## Current state

Only Phase 0 is implemented. It provides a credential-free safety harness,
permission and retention records, capability defaults, the owner H0 procedure,
and a hard quarantine around the v1 Etsy/OpenAI clients.

Nothing in this branch authorizes or enables live Etsy reads, Etsy writes, AI
processing, invited shops, randomized experiments, or production deployment.
H0 remains `not_run` in `docs/gates/G0.json`.

Run the safe gate locally:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 validation/phase0/validate_phase0.py
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

## Next gate

The owner completes `docs/rebuild/owner-h0-checklist.md` against the actual Etsy
developer application records. Scope-sensitive identifiers and evidence belong
in the ignored `docs/gates/private/` location; only redacted hashes and status
belong in tracked gate records. Phase 1 may begin live read-only reconciliation
only after that gate is passed for an exact scope.
