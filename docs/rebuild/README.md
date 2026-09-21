# Rebuild gate dossier

This directory contains the gate dossier for the authoritative replacement
plan. Phase 0 remains credential-free and default-deny. H0 now permits a narrow
Phase 1 read-only validation scope for the owner's shop; production runtime,
writes, AI, external shops, and experiments remain disabled.

The JSON records are machine-checked policy inputs. Scope-sensitive H0 evidence,
the disposable SQLite store, and reconciliation reports remain ignored under
`docs/gates/private/`. Tracked records contain only redacted counts and hashes.
Unknown permission or retention cells stay disabled; possession of an Etsy
token is not authorization.

Run:

```bash
node --version  # requires Node 24+
npm ci --ignore-scripts
python3 -m pip install --disable-pip-version-check -r validation/requirements.txt
python3 validation/phase0/validate_phase0.py
python3 -m unittest discover -s validation -p 'test_*.py' -v
python3 validation/phase1/validate_phase1.py
python3 validation/phase2/validate_phase2.py
python3 validation/phase3/validate_phase3.py
```

The legacy runtime is preserved by Git tag `legacy-v1-2026-09-20` and is hard
disabled on the rebuild branch before it can construct its network clients.
Its ignored data and credentials are not imported into the replacement.

Phase 1 contracts and current quality evidence are in
`phase1-source-contracts.md`, `measurement-profile-v1.draft.json`, and
`phase1-data-quality-report.md`. G1 remains open until seven day-boundary
observations and H1 reconciliation are complete.

Phase 2 contracts and evidence are in `phase2-method-profile.md`,
`phase2-eligibility-report.md`, `packages/contracts`, `packages/engine`, and
`validation/phase2`. The versioned JSON Schemas are executable runtime shape
contracts, with semantic validation for cross-field and hash invariants. A2 is
credential-free. G2 does not pass until the owner
completes H2 and accepts either the qualified randomized route or the explicit
directional-only route. No randomized or write capability is enabled.

Phase 3 implementation and credential-free local fault evidence are in
`phase3-foundation.md`, `adr-0002-phase3-safe-mutation-foundation.md`,
`apps/worker`, `apps/web`, `packages/operations`, `packages/etsy`,
`packages/security`, `migrations`, and `validation/phase3`. Local A3 evidence
does not pass G3: deployed simulator/Cloudflare evidence and the exact owner H3
canary remain required, and all checked-in write controls default off.
