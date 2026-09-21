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
python3 validation/phase0/validate_phase0.py
python3 -m unittest discover -s validation -p 'test_*.py' -v
```

The legacy runtime is preserved by Git tag `legacy-v1-2026-09-20` and is hard
disabled on the rebuild branch before it can construct its network clients.
Its ignored data and credentials are not imported into the replacement.

Phase 1 contracts and current quality evidence are in
`phase1-source-contracts.md`, `measurement-profile-v1.draft.json`, and
`phase1-data-quality-report.md`. G1 remains open until live receipt access,
seven day-boundary observations, and H1 reconciliation are complete.
