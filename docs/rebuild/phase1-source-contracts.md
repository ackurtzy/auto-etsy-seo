# Phase 1 source contracts

Captured 2026-09-20 from Etsy's current official Open API v3 documentation.
These are validation contracts, not production capability approvals.

## Endpoints in scope

- `GET /v3/application/shops/{shop_id}/listings/active` uses API-key
  authentication, supports `limit` 1–100 plus `offset`, and returns a reported
  `count` and `results`. Phase 1 requires gap-free pagination and sanitizes each
  listing before persistence.
- `GET /v3/application/listings/{listing_id}` uses API-key authentication and
  is allowed only for the ten signed sample identifiers. It is reserved for
  inactive/sold-out diagnosis and is not yet called by the initial probe.
- `GET /v3/application/shops/{shop_id}/receipts` requires OAuth scope
  `transactions_r`, supports creation/last-modified bounds, and is paginated.
  Buyer identity and address fields are discarded by a whitelist before any
  persistent or report sink.
- Rate limits are application-key based QPS and rolling-24-hour QPD limits.
  `429` includes `Retry-After`. The Phase 1 probe has a local maximum of 25
  requests and does not automatically retry a 429.

Official references:

- <https://developers.etsy.com/documentation/reference>
- <https://developers.etsy.com/documentation/essentials/authentication/>
- <https://developers.etsy.com/documentation/essentials/rate-limits/>
- <https://developers.etsy.com/documentation/essentials/requests/>

## Meaning and maturity

| Field or outcome | Current contract | Phase 1 disposition |
| --- | --- | --- |
| Listing identity/state/title/tags | Direct listing fields, normalized to NFC and HTML entities decoded for comparison. | Candidate for H1 comparison; write serialization remains a draft until G3. |
| `views` | Present on listing payloads, but the official reference does not establish a source period, uniqueness, latency, or reset contract suitable for experimental outcomes. | Unavailable as an enabled outcome until seven consecutive day-boundary observations and equivalent owner comparison establish semantics. Zero is unknown, not assumed zero activity. |
| Transaction identity/quantity | Transaction/line identity plus listing identity and integer quantity. | Candidate outcome only after H1 receipt reconciliation. Duplicate transaction IDs do not add units. |
| Item money | Transaction price money (`amount / divisor`, currency) multiplied by quantity. | Candidate outcome only where divisor/currency are valid and H1 confirms the definition. Shipping, tax, and whole-receipt totals are never attributed to each listing. |
| Refunds/discounts | Receipt and transaction schemas expose adjustments, but source allocation must be established from observed applicable payloads. | Unknown where an adjustment cannot be allocated to a transaction/listing; no estimate or proportional allocation. |
| Missing/inactive listing | A missing page, 404, or absent member is not zero. | Explicitly unavailable; diagnose only with an authorized sample read. |

## Privacy and coverage invariants

- Persist only whitelisted listing, receipt, transaction, money, status, and
  timestamp fields. Never persist buyer IDs, names, email, addresses,
  personalization, messages, or shipping destination.
- A source watermark advances only after every expected page is present and
  the stable reported count is reconciled.
- Immutable fact revisions retain their source version. A conflicting payload
  with the same source version is quarantined rather than silently replacing
  the canonical pointer.
- The local SQLite database and detailed reconciliation report are disposable,
  ignored evidence. Only redacted counts and hashes may be tracked.
