# Venus Voice Integration Guide v2 (6esk <-> Venus)

This contract is focused on safe AI calling through 6esk.

## Scope Boundary
- 6esk owns:
  - call execution orchestration, ticket linkage, call lifecycle, recording/transcript attachment, policy enforcement.
- Venus owns:
  - AI reasoning, voice/LLM providers, character/knowledge, tool-choice logic.
- Explicit boundary:
  - AI/voice provider keys stay in `C:\Users\choma\Desktop\Venus-develop`.
  - Do not send those keys to 6esk.

## Integration Objectives
- AI and human call flows share the same 6esk backend behavior.
- AI can place calls only through explicit, auditable APIs.
- Ambiguous phone choices cannot be auto-dialed.

## Auth and Trust

### Venus -> 6esk requests
- `x-6esk-agent-id` (recommended)
- `x-6esk-agent-key` or `Authorization: Bearer`

### 6esk -> Venus events
- `x-6esk-signature` (HMAC SHA256)
- `x-6esk-timestamp`

Venus webhook verifier must:
- reject if timestamp skew exceeds allowed window (recommended 5 minutes)
- compute HMAC over `{timestamp}.{rawBody}`
- compare using constant-time compare

Current 6esk webhook signing contract:
- header `x-6esk-timestamp` is required when replay checks are enabled.
- HMAC payload is `${x-6esk-timestamp}.${rawBody}`.
- legacy body-only signatures are disabled by default and only allowed with
  `CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE=true` (temporary migration only).

## Required 6esk Surfaces for Venus
- `GET /api/agent/v1/tickets/{ticketId}`
- `GET /api/agent/v1/tickets/{ticketId}/messages`
- `GET /api/agent/v1/tickets/{ticketId}/call-options` (new)
- `POST /api/agent/v1/actions` with `type: "initiate_call"` (new action type)

## Call Tool Contract for Venus

### Tool 1: `sixesk_get_ticket_call_options`
Input:
- `ticketId`

Output:
- `selectionRequired`
- `defaultCandidateId`
- `candidates[]` with stable `candidateId`
- `canManualDial`

### Tool 2: `sixesk_initiate_ticket_call`
Input:
- `ticketId` (required)
- `candidateId` or `toPhone` (required)
- `reason` (required)
- `idempotencyKey` (required)
- `metadata.workflowId` (required for correlation)

Output:
- `status` in `ok | selection_required | blocked | failed`
- `callSessionId` when queued/started
- `errorCode` for deterministic handling

## Required AI Behavior
- Always call `call-options` before placing a call unless an explicit human-chosen `candidateId` is already known.
- If `selectionRequired=true`, do not call until explicit candidate is chosen.
- Always send a unique `idempotencyKey` per user intent.
- Attach `workflowId` to metadata for event correlation.

## Error Model (Suggested)
- `selection_required`
- `capability_not_enabled`
- `outside_allowed_hours`
- `consent_required`
- `invalid_phone`
- `rate_limited`
- `provider_unavailable`
- `duplicate_request`

## Event Consumption Contract
Venus should consume and reconcile:
- `ticket.call.started`
- `ticket.call.ended`
- `ticket.call.recording.ready`
- `ticket.call.failed`
- `ticket.call.selection.required`

Expected Venus reaction:
- `call.started`: mark workflow step active.
- `call.ended`: close call step, store duration/outcome.
- `recording.ready`: enqueue summarization/QA toolchain.
- `selection.required`: route to human choice prompt.
- `call.failed`: apply retry strategy only if error is retryable.

## Safety Controls
- Never auto-dial when more than one number is available.
- Never bypass 6esk voice capability gate (`allowVoiceActions=true`).
- Respect 6esk voice policy (`allowed hours`, `consent`, `rate limits`).
- Redact phone numbers in Venus logs (`+1555******67` format).

## Retry and Idempotency
- Venus retries must reuse the same `idempotencyKey` for the same intended call.
- New user intent requires a new `idempotencyKey`.
- Backoff recommendation:
  - 1st retry: 15s
  - 2nd retry: 60s
  - 3rd retry: 5m
- Do not retry on `selection_required`, `consent_required`, `invalid_phone`.

## Venus Repo Work Plan

### Phase A: Client + Tools
- Add `sixeskVoiceClient` module with typed responses/errors.
- Register tools:
  - `sixesk_get_ticket_call_options`
  - `sixesk_initiate_ticket_call`

### Phase B: Agent Policy Layer
- Add pre-call policy checks:
  - user permission context
  - selection-required handling
  - consent requirement state
- Add deterministic error handling map by `errorCode`.

### Phase C: Event Reconciliation
- Verify 6esk webhook signature and timestamp.
- Correlate lifecycle events by `ticketId`, `callSessionId`, `workflowId`.
- Close workflow only on terminal call status.

## Environment Expectations (Venus)
- Existing CRM bridge env remains unchanged.
- Add:
  - `VENUS_ENABLE_VOICE_BRIDGE=true`
  - `SIXESK_VOICE_ENABLED=true`
  - `SIXESK_AGENT_ID=<agent_integration_id>`
  - `SIXESK_AGENT_KEY=<shared_secret>`
  - `SIXESK_VOICE_EVENT_SKEW_SECONDS=300`

## Open Decisions
- Should AI voice require `auto_send` mode or independent voice policy gate.
- Max concurrent AI calls per integration.
- Whether manual-dial numbers require human confirmation in all cases.

## Current 6esk Status (February 18, 2026)
- Implemented:
  - outbound/inbound call session model with ticket linkage
  - call options APIs for human + AI paths
  - `initiate_call` AI action with voice capability gate
  - voice policy checks (hours, consent, per-hour caps)
  - recording + transcript attachment to ticket messages
  - transcript shown as expandable raw text in ticket message detail
  - analytics overview/volume voice outcomes and duration metrics
  - admin call ops endpoints and UI (`outbox`, `failed`, `retry`, `rejections`)
  - phone redaction for call-focused audit/admin payloads
  - webhook rejection audit logs and replay-window validation
  - call ops runbook and replay/load drill scripts for safe validation
- Deferred:
  - non-mock provider dial adapter (`CALLS_PROVIDER=mock` remains default)
