# Voice Privacy And Retention

This document is the 6esk internal reference for voice consent history and call artifact retention wording.
Use this wording in privacy policy updates, support responses, and operational runbooks.

## Consent History (6esk Source Of Truth)

- Voice consent is stored in `6esk` database table `voice_consent_events`.
- Consent state is event-based (`granted` / `revoked`) and includes:
  - terms version
  - source
  - timestamp
  - callback phone (when provided)
- Ticket metadata can contain consent hints, but enforcement and current-state evaluation must use `voice_consent_events`.

## Outbound Call Enforcement

- New outbound call attempts must respect the latest consent state from 6esk.
- A latest state of `revoked` blocks outbound calls until a new `granted` event is recorded.
- Agent UI should display consent state and callback phone before dial actions.

## Recording And Transcript Wording

Use the same phrasing in customer-facing privacy docs and internal SOPs:

- Call recordings and transcripts are stored only for the period defined in the active Terms and Conditions and privacy notice.
- Storage beyond that period is allowed only for legal/regulatory obligations, dispute handling, or approved incident forensics.
- Consent event history is retained as compliance/audit evidence according to internal legal retention policy.

## Operational Alignment Checklist

- Keep `CALLS_CONSENT_TERMS_VERSION` in sync with the current published T&Cs version.
- Update this file and customer-facing privacy wording in the same change whenever terms wording changes.
- Ensure support/help revoke flows write a `revoked` event to `voice_consent_events`.
