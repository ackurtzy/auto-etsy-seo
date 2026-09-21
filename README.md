# Auto Etsy SEO

Auto Etsy SEO is being rebuilt as a gated, independent Etsy listing experiment
product. The authoritative implementation source is identified by
`docs/rebuild/plan-source.json`.

## Current state

Phase 0 is complete for the owner's narrowly approved read-only scope. Phase 1
has complete 30-day listing/receipt source coverage but still awaits H1 and the
seven-day views diagnostic. Phase 2 now provides a pure TypeScript statistical
engine, independent Python reference, frozen evidence contracts, and offline
release simulations. G2 awaits the owner's H2 interpretation and product-route
decision. The v1 Etsy/OpenAI runtime remains quarantined.

The only live capability is bounded Phase 1 validation for the owner's shop as
recorded in the signed, ignored G0 evidence. Nothing enables Etsy writes, AI
processing, invited shops, randomized experiments, or production deployment.

Run the safe gate locally:

```bash
node --version  # requires Node 24+
npm ci --ignore-scripts
python3 -m pip install --disable-pip-version-check -r validation/requirements.txt
PYTHONDONTWRITEBYTECODE=1 python3 validation/phase0/validate_phase0.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s validation -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 validation/phase1/validate_phase1.py
PYTHONDONTWRITEBYTECODE=1 python3 validation/phase2/validate_phase2.py
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

The configured 30-day listing and receipt observation completed on 2026-09-21.
G1 remains open until the seven-day view diagnostic and H1 owner comparison
are complete. Current endpoint and field dispositions are in
`docs/rebuild/phase1-source-contracts.md`.

## Phase 2 statistical validation

Phase 2 runs without credentials or external requests. Its JSON Schemas are
compiled at runtime and paired with semantic validation for cross-field rules,
balanced assignment, and content hashes:

```bash
npm run typecheck:phase2
npm run test:phase2
PYTHONDONTWRITEBYTECODE=1 python3 validation/phase2/validate_reference.py
PYTHONDONTWRITEBYTECODE=1 python3 validation/phase2/validate_phase2.py
```

The current shop is not randomized-eligible. Its permitted 30-day evidence is
too concentrated under a listing-as-cluster diagnostic, independent clusters
have not been established, and G1/H1 remain incomplete. The supported current
route is human-directed before/after reporting with no causal confidence or
automatic winner. Randomized functionality remains disabled.
