# Rebuild gate dossier

This directory implements Phase 0 of the authoritative replacement plan. It is
deliberately useful without credentials and enables no live processing.

The JSON records are machine-checked policy inputs. `owner-h0-checklist.md` is
the exact human procedure needed before Phase 1 may use an allowlisted live
read. Unknown permission or retention cells stay disabled; possession of an
Etsy token is not authorization.

Run:

```bash
python3 validation/phase0/validate_phase0.py
```

The legacy runtime is preserved by Git tag `legacy-v1-2026-09-20` and is hard
disabled on the rebuild branch before it can construct its network clients.
Its ignored data and credentials are not imported into the replacement.
