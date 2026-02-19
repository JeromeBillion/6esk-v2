# Call Capabilities Plan v2 (Inbound + Outbound + AI)

This version tightens the plan with concrete constraints, measurable quality gates, and explicit AI safety behavior.

## Implementation Snapshot (February 18, 2026)
- Completed in repo:
  - schema foundations (`voice`, `call_sessions`, `call_events`, `call_outbox_events`)
  - inbound/status/recording/transcript webhooks with HMAC + replay-window checks
  - outbound queue path for human + AI with idempotency and policy enforcement
  - create-ticket and existing-ticket call options flows
  - AI `call-options` + `initiate_call` support
  - transcript storage + expandable/retractable raw transcript in ticket detail
  - analytics voice metrics in overview + volume APIs/UI
  - admin call operations endpoints and dashboard section
  - phone redaction for call-focused audit/admin operations data
  - failure-injection regression tests for replay/outbox retry behavior
  - call operations runbook + replay/load drill scripts
- Deferred:
  - production provider adapter beyond mock outbox sender

## Assessment Summary
Strengths already in 6esk:
- Existing message/ticket timeline model can absorb `voice` as another channel.
- Existing inbound idempotency pattern (`inbound_events`) can be reused for call webhooks.
- Existing outbox/retry approach can be reused for outbound call delivery.
- Existing agent auth model supports machine-safe integrations for Venus.

Gaps that needed tightening:
- No explicit call state machine and terminal outcomes.
- No strict AI permission model for voice actions.
- No measurable release gates or rollback triggers.
- No exact handling for `one number` vs `multiple numbers` vs `no number`.

## Product Requirements (Locked)
- `Create Ticket` must support `Email` or `Call` mode.
- In call mode, entering a phone number creates ticket + starts outbound call.
- Existing tickets (email/WhatsApp/voice) must expose the same call action.
- Call recording and transcript pointers must attach to the current ticket.
- One phone number: auto-fill/auto-select.
- Multiple numbers: force explicit selection by agent (human or AI).
- No numbers: require manual number entry.
- Voice actions are available to both human and AI paths with the same guardrails.

## Architecture Decisions
- 6esk is the control plane for ticket-linked call records, policy checks, and audit trail.
- Venus is the decisioning layer for AI workflows and uses 6esk APIs to execute calls.
- AI/voice model keys, character config, and knowledge remain in `Venus-develop`.
- Telephony provider integration can be in 6esk; do not pass AI provider keys into 6esk.

## UX Flows

### 1) Create Ticket -> Call
- `src/app/tickets/new/NewTicketClient.tsx` becomes dual-mode:
  - `Contact Mode = Email | Call`
  - call fields: `toPhone`, optional `displayName`, `reason`
- Submit in call mode:
  - create ticket
  - queue call
  - write voice timeline row
  - attach recording/transcript when ready

### 2) Call From Existing Ticket
- Add `Call` action in ticket view for all channels.
- Show number picker when multiple candidates exist.
- Manual override is allowed but logged in audit metadata.

### 3) Number Resolution Rule
- Candidate sources:
  - `customers.primary_phone`
  - `customer_identities(identity_type='phone')`
  - trusted ticket metadata fallback
- Output model:
  - `selectionRequired = false` + `defaultCandidateId` when exactly one
  - `selectionRequired = true` when more than one
  - `candidates = []` when none

## Data Model
- Extend `message_channel` enum: add `voice`.
- Add `call_sessions`:
  - `id`, `provider`, `provider_call_id` (unique)
  - `ticket_id`, `mailbox_id`, `message_id`
  - `direction` (`inbound` | `outbound`)
  - `from_phone`, `to_phone`
  - `status`
  - `queued_at`, `started_at`, `ended_at`, `duration_seconds`
  - `recording_url`, `recording_r2_key`, `transcript_r2_key`
  - `created_by` (`human` | `ai` | `system`)
  - `created_by_user_id`, `created_by_integration_id`
  - `metadata`, timestamps
- Add `call_events`:
  - `id`, `call_session_id`, `event_type`, `occurred_at`, `payload`, `created_at`
- Add `call_outbox_events` (recommended):
  - same retry semantics as WhatsApp outbox (`status`, `attempt_count`, `next_attempt_at`, `last_error`)

## Call State Machine
Allowed transitions:
- `queued -> dialing -> ringing -> in_progress -> completed`
- `queued|dialing|ringing -> no_answer|busy|failed|canceled`
- `in_progress -> failed` (provider interruption)

Rules:
- Ignore stale state updates using provider event timestamp ordering.
- Duplicate webhook events are idempotently accepted and no-op if state already applied.
- Terminal states: `completed`, `no_answer`, `busy`, `failed`, `canceled`.

## API Contracts (MVP)

### Human outbound call
- `POST /api/calls/outbound`
- Auth: session user with ticket permissions.
- Input:
  - `ticketId` (required)
  - `candidateId` or `toPhone` (one required)
  - `reason` (required)
  - `idempotencyKey` (required)
- Response statuses:
  - `queued`
  - `selection_required`
  - `blocked` (policy/consent/permissions)
  - `failed`

### Inbound/provider callbacks
- `POST /api/calls/inbound`
- `POST /api/calls/status`
- `POST /api/calls/recording`
- Security:
  - provider signature verification
  - replay window check
  - idempotency key (`provider + provider_call_id + event_type + timestamp`)

### AI endpoints
- `GET /api/agent/v1/tickets/{ticketId}/call-options`
- Extend `POST /api/agent/v1/actions` with `type: "initiate_call"`.

`initiate_call` required behavior:
- If `selectionRequired=true` and no explicit `candidateId`, return `selection_required`.
- Enforce agent capability `allowVoiceActions=true`.
- Enforce policy window and per-integration rate limits.

## Permissions and Policy
- Human:
  - same ticket permission gates as reply/send actions.
- AI:
  - new integration capability: `allowVoiceActions`.
  - optional policy object:
    - `voice.enabled`
    - `voice.allowed_hours`
    - `voice.require_human_confirmation_for_unknown_numbers`
    - `voice.max_calls_per_hour`

Feature flags:
- `CALLS_ENABLED`
- `CALLS_AI_ENABLED`
- `CALL_RECORDING_ENABLED`
- `CALL_TRANSCRIPTION_ENABLED`

## Observability and Metrics
- Core KPIs:
  - outbound attempts, connect rate, answer rate
  - median setup time (`queued -> in_progress`)
  - average duration
  - failed/busy/no-answer rates
- Reliability:
  - webhook verification failure count
  - duplicate webhook count
  - outbox retry depth and dead-letter count

## Phase Plan With Quality Gates

### Phase 0: Policy/Provider/Schema Decision (1 week)
Deliverables:
- provider selection
- consent/retention policy
- call state machine sign-off

Quality gate:
- all legal/policy decisions approved, no open blockers.

### Phase 1: Storage + Inbound Pipeline (2 weeks)
Deliverables:
- migrations for `voice`, `call_sessions`, `call_events`
- inbound/status/recording webhooks with signature + idempotency
- ticket timeline linkage + recording attachment path

Quality gate:
- replayed webhook does not duplicate state.
- missed calls create actionable ticket event.

### Phase 2: Human Outbound UX (2 weeks)
Deliverables:
- create-ticket dual mode
- call action on all ticket channels
- number picker and manual override flow
- outbound queue and retry worker

Quality gate:
- agent can call from new ticket and existing ticket; recording attaches correctly.

### Phase 3: AI Voice Actions (1-2 weeks)
Deliverables:
- `call-options` endpoint
- `initiate_call` action support
- `selection_required` and policy block outcomes
- agent events for call lifecycle

Quality gate:
- AI cannot place ambiguous-number call without explicit selection.
- integration capability gate blocks unauthorized AI voice actions.

### Phase 4: Analytics + Hardening (1-2 weeks)
Deliverables:
- voice metrics on overview/volume dashboards
- PII redaction policy in logs
- dead-letter and operational runbook

Quality gate:
- rollout SLOs met for 14 consecutive days in pilot.

## Cross-Cutting Refactors (Must Do Early)
- Replace hardcoded `email | whatsapp` unions with shared channel type.
- Replace `has_whatsapp` inference with channel summary model.
- Update merge/search/history logic that assumes non-WhatsApp equals email.
- Update ticket filter/query APIs to support `voice`.

## Rollout and Rollback
Rollout:
- Stage 1 shadow ingest
- Stage 2 human pilot
- Stage 3 full human rollout
- Stage 4 AI rollout by integration allowlist

Rollback triggers:
- signature verification failures > 2% events over 15 min
- duplicate call creation rate > 0.5%
- call completion webhook lag > 5 min p95

Rollback actions:
- disable `CALLS_AI_ENABLED`
- disable outbound via policy switch
- keep ingest on for forensic continuity
