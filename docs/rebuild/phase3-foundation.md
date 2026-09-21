# Phase 3 production foundation

## Implemented boundary

Phase 3 now has a production-shaped Cloudflare Worker, D1 migrations, a per-shop Durable Object, a bounded operation Workflow, private R2 recovery contracts, Clerk authentication, encrypted Etsy OAuth credentials, Resend incident delivery, and a minimal React review/recovery UI.

The first mutation capability is one complete listing title. Its public lifecycle is:

`queued → validating → prepared → dispatching → verifying → verified`

Explicit alternatives are `rejected`, `cancelled_before_dispatch`, `unknown`, `conflict`, and `manual_required`. A potentially sent attempt is never replayed. Unknown outcomes retain the shop lane and consume only the reserved reconciliation reads.

Tags remain a separate disabled grant (`tags-v1`) pending their own normalization, preservation, deployed canary, and H3 evidence. No media route exists.

## Safety defaults

- `ETSY_EGRESS_ENABLED=false` and `TITLE_WRITES_ENABLED=false` in the checked-in Worker config.
- `workers_dev=false`; a custom domain is required for a deployment.
- Fresh and restored databases have `restore_state.egress_enabled=0`.
- New Etsy connections create title and tag grants as `disabled`, a paused shop lane, zero daily write allowance, and an active shop kill switch.
- Secrets exist only as Worker secrets or local ignored `.dev.vars`, never Wrangler plaintext variables.
- A canary grant binds exact listing, baseline hash, proposed hash, gate hash, epochs, and expiry. General enablement is a separate post-H3 action.

## Local verification

These commands are credential-free and make no Etsy requests:

```bash
npm ci --ignore-scripts
npm run cf:types
npm run typecheck:phase2
npm run test:phase2
npm run typecheck:phase3
npm run test:phase3
npx tsc -p apps/web/tsconfig.json --noEmit
npm run build:web
npm run db:migrate:local
npm run cf:dry-run
python3 -m unittest discover -s validation -p 'test_*.py' -v
python3 validation/phase0/validate_phase0.py
python3 validation/phase1/validate_phase1.py
python3 validation/phase2/validate_phase2.py
python3 validation/phase3/validate_phase3.py
```

## Deployment and gate sequence

Do not provision or deploy this phase as a write-capable service until G1/H1 and the G2 owner disposition are recorded.

1. Create isolated staging D1 and R2 resources and a custom-domain Worker. Replace the local binding names/IDs in a deployment-specific Wrangler configuration; keep both runtime gates false.
2. Configure Clerk and Resend. Set `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ETSY_CLIENT_ID`, `ETSY_API_KEY`, `CREDENTIAL_ENCRYPTION_KEY`, `RESEND_API_KEY`, and `INCIDENT_EMAIL` with `wrangler secret put`; never paste them into files or logs.
3. Apply D1 migrations and deploy with external Etsy egress denied. Connect only the approved owner tenant/shop through PKCE. The created connection remains paused and disabled.
4. Run G3a in staging against the strict provider simulator and exercise F01–F15, notification delivery, encrypted token rotation, tenant isolation, quota exhaustion, and isolated restore. Record deployed build IDs and artifact hashes.
5. After G3a passes, prepare a separately signed, expiring canary grant for one exact low-risk listing/title/revert pair. Stop the legacy writer first. Only then set the staging/production runtime egress gates required for that exact H3 demonstration.
6. Complete H3 directly in Etsy Shop Manager. Any unknown canary, preservation defect, notification failure, or restore reactivation leaves title T3 disabled and the shop lane blocked.

The checked-in repository intentionally contains no resource IDs, tokens, tenant identifiers, live listing IDs, or canary values.
