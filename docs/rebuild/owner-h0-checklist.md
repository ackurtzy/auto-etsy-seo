# H0 owner review — permission and scope

Status: **not run**. Completing this form authorizes only the exact read scope
recorded here; it never authorizes writes.

The owner must review the actual Etsy developer application/access records and
record protected evidence for each item:

- Approved purpose and access for the owner's shop.
- Whether listing analytics, historical evidence, and AI processing are within
  that approved purpose.
- Whether invited external shops are separately authorized. If unclear, leave
  external onboarding disabled.
- Approved vendors and the exact sanitized fields that may leave Etsy.
- Retention/deletion limits for diagnostics, logs, backups, tokens, and
  de-identified evidence.
- One read-only shop and up to ten representative listing IDs for G1, stored in
  an ignored `docs/gates/private/` record that follows the private evidence
  schema. The tracked G0 record contains only redacted scope labels and hashes.
- Initial Etsy/AI budgets, support contact, and a future low-risk canary listing.
- The owner-controlled location and protection method for the legacy local-data
  archive; credentials must not enter source control or a plaintext archive.
- Confirmation that the legacy Flask runtime, manual scripts, and any schedules
  remain disabled.

Pass only when every Phase 1 activity is supported by recorded evidence. Store
scope-sensitive evidence in `docs/gates/private/`, then record only redacted
hashes, status, approver, approval/expiry times, and disabled capabilities in
`docs/gates/G0.json`. A token, working request, or synthetic test is not
permission evidence.
