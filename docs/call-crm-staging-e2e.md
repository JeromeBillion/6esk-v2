# CRM Calls Staging E2E Harness

This runbook executes the `CRM_CALLS.md` staging checklist against `6esk` without modifying `Venus-develop`.

## Command

```bash
npm run calls:crm-e2e
```

## Required Env

```env
APP_URL=https://<your-6esk-domain>
CALLS_WEBHOOK_SECRET=<webhook-hmac-secret>
SIXESK_AGENT_ID=<agent_integration_id>
SIXESK_AGENT_KEY=<agent_shared_secret>
CRM_CALLS_TICKET_ID=<ticket_uuid_for_staging>
```

## Optional Env

```env
CRM_CALLS_REASON=CRM_CALLS staging orchestration check
CRM_CALLS_IDEMPOTENCY_KEY=crm-e2e-<stable-key>
CRM_CALLS_CANDIDATE_ID=<candidate_id_from_call_options>
CRM_CALLS_TO_PHONE=+15551234567
CRM_CALLS_FROM_PHONE=+15557654321

# Optional downstream verification of Venus event observation:
CRM_CALLS_VENUS_EVENTS_URL=https://<venus-host>/api/<events-endpoint>
CRM_CALLS_VENUS_EVENTS_TOKEN=<optional-bearer-token>

# Optional local verification of event sequencing via DB:
DATABASE_URL=postgres://...
```

Notes:
- Provide either `CRM_CALLS_CANDIDATE_ID` or `CRM_CALLS_TO_PHONE` if call options require explicit selection.
- `DATABASE_URL` is only needed for local sequence checks against `agent_outbox`.
- `CRM_CALLS_VENUS_EVENTS_URL` is optional; when unset, Venus observation checks are skipped.

## What It Verifies

1. `GET /api/agent/v1/tickets/{ticketId}/call-options` response shape and candidate records.
2. `POST /api/agent/v1/actions` with `type: "initiate_call"` returns deterministic `ok`.
3. Duplicate `initiate_call` with same `idempotencyKey` returns same `callSessionId` and `idempotent=true`.
4. Lifecycle progression through signed status webhooks (`in_progress`, `completed`).
5. Transcript ingestion through signed `/api/calls/transcript`.
6. Transcript-summary writeback idempotency through `request_human_review`:
  - first call => `deduplicated=false`
  - duplicate call with same `callSessionId + idempotencyKey` => `deduplicated=true`
7. Optional local check: monotonic `call.sequence` and stable `call.eventIdempotencyKey` in `agent_outbox`.
8. Optional Venus check: presence/order of `ticket.call.*` events for the same `callSessionId`.

## Expected Output

The script prints a `PASS/FAIL` summary per checklist item and exits non-zero on failures.
