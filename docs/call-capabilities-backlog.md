# Call Capabilities Backlog (Execution)

This backlog converts `docs/call-capabilities-plan.md` into implementation work items with sequencing and estimates.

## Current Status (March 29, 2026)
- Done/mostly done:
  - E1 foundations
  - E2 inbound voice pipeline (including replay-window checks)
  - E3 outbound queue path including `6esk` `http_bridge` delivery and `6ex` Twilio-capable bridge ingestion
  - E4 human UX core call flows
  - E5 AI voice actions and policy gate
  - E7 analytics + ops endpoints/UI baseline
  - VOICE-072 baseline PII phone redaction for call audit/admin surfaces
  - VOICE-074 baseline failure-injection tests for replay-window and outbox retry paths
  - VOICE-075 baseline call ops runbook + drill scripts (replay/load/retry)
- In progress:
  - live provider callback rehearsal and pilot hardening against the chosen Twilio deployment

## Planning Assumptions
- Estimate unit: engineering days (ideal).
- Team model used for schedule projection:
  - 1 backend engineer
  - 1 full-stack engineer
  - 0.5 frontend engineer
  - 0.5 QA/support from week 3 onward
- Scope includes:
  - 6esk implementation
  - integration contract updates for Venus
- Scope excludes:
  - LLM/voice provider key, character, or knowledge management in 6esk.

## Effort Summary
- 6esk core (DB/API/UI/analytics/ops): 45 to 63 eng-days
- Venus integration track: 8 to 12 eng-days
- Total combined: 53 to 75 eng-days
- Delivery window with assumed team: 6 to 8 weeks

## Epic Overview
| Epic | Name | Estimate (eng-days) | Priority | Depends On |
|---|---|---:|---|---|
| E0 | Policy + Provider Lock | 3-5 | P0 | - |
| E1 | Channel Foundations + Schema | 8-12 | P0 | E0 |
| E2 | Inbound Voice Pipeline | 8-11 | P0 | E1 |
| E3 | Outbound Voice Pipeline | 9-12 | P0 | E1 |
| E4 | Human UX (Create + Ticket Call) | 8-11 | P0 | E1, E3 |
| E5 | AI Voice Actions in 6esk | 6-8 | P0 | E1, E3 |
| E6 | Venus Voice Plugin Track | 8-12 | P1 | E5 |
| E7 | Analytics + Hardening + Rollout | 11-14 | P0 | E2, E3, E4, E5 |

## Detailed Backlog

### E0: Policy + Provider Lock
| ID | Work Item | Estimate | Depends On | Acceptance |
|---|---|---:|---|---|
| VOICE-001 | Confirm telephony provider + webhook auth scheme | 1 | - | Provider and webhook signature scheme documented |
| VOICE-002 | Recording consent and retention policy by region | 1-2 | VOICE-001 | Approved policy linked in docs |
| VOICE-003 | AI call policy defaults (`hours`, `caps`, `confirmation rules`) | 1-2 | VOICE-002 | Policy fields and defaults approved |

### E1: Channel Foundations + Schema
| ID | Work Item | Estimate | Depends On | Acceptance |
|---|---|---:|---|---|
| VOICE-010 | Migration: add `voice` to `message_channel` | 1 | VOICE-003 | Migration runs cleanly and rollback documented |
| VOICE-011 | Migration: create `call_sessions` table | 1-2 | VOICE-010 | Table + indexes + constraints created |
| VOICE-012 | Migration: create `call_events` table | 1 | VOICE-011 | Table + FK/indexes in place |
| VOICE-013 | Migration: create `call_outbox_events` table | 1 | VOICE-011 | Retry fields match WhatsApp semantics |
| VOICE-014 | Shared channel type refactor (`email|whatsapp` -> `email|whatsapp|voice`) | 2-3 | VOICE-010 | Type errors resolved across API/server/UI |
| VOICE-015 | Replace `has_whatsapp` inference with channel summary model | 2-3 | VOICE-014 | Search/history/merge use channel summary safely |
| VOICE-016 | Regression tests for channel refactor | 1-2 | VOICE-014 | Existing tests green plus new voice-safe coverage |

### E2: Inbound Voice Pipeline
| ID | Work Item | Estimate | Depends On | Acceptance |
|---|---|---:|---|---|
| VOICE-020 | Provider webhook signature verifier + replay-window utility | 1-2 | VOICE-001 | Invalid signatures rejected, replay blocked |
| VOICE-021 | `POST /api/calls/inbound` route + normalization | 2 | VOICE-020 | Inbound call creates/links ticket and session |
| VOICE-022 | `POST /api/calls/status` lifecycle updates | 2 | VOICE-021 | Status transitions enforce state machine |
| VOICE-023 | `POST /api/calls/recording` artifact callback | 2 | VOICE-021 | Recording pointer attached to same ticket/session |
| VOICE-024 | Inbound idempotency + retry event store | 1-2 | VOICE-021 | Duplicate events no-op; failed events retryable |
| VOICE-025 | Call timeline message creation (`channel=voice`) | 1 | VOICE-021 | Ticket timeline shows voice lifecycle |
| VOICE-026 | Inbound alerting and retry scripts/runbook | 1-2 | VOICE-024 | Ops trigger documented and tested |

### E3: Outbound Voice Pipeline
| ID | Work Item | Estimate | Depends On | Acceptance |
|---|---|---:|---|---|
| VOICE-030 | Number candidate resolver service | 1-2 | VOICE-011 | Returns deterministic candidates/default/selectionRequired |
| VOICE-031 | `POST /api/calls/outbound` (human path) | 2 | VOICE-030 | Queues call or returns `selection_required` |
| VOICE-032 | Outbound queue lock/deliver worker (`call_outbox_events`) | 2-3 | VOICE-013 | Retry/backoff/terminal failure behavior works |
| VOICE-033 | Provider adapter for dial action + provider call ID correlation | 2 | VOICE-032 | Provider call IDs mapped to sessions |
| VOICE-034 | Audit + ticket event emission for outbound attempts/results | 1 | VOICE-031 | Audit logs and ticket events present |
| VOICE-035 | Per-user and per-integration rate limits for call initiation | 1-2 | VOICE-031 | Limits enforced with explicit error code |

### E4: Human UX (Create + Ticket Call)
| ID | Work Item | Estimate | Depends On | Acceptance |
|---|---|---:|---|---|
| VOICE-040 | `Create Ticket` dual mode (`Email` / `Call`) UI | 2-3 | VOICE-031 | Call mode creates ticket + queues call |
| VOICE-041 | Existing ticket call action across all channels | 2 | VOICE-031 | Call CTA visible for email/WhatsApp/voice tickets |
| VOICE-042 | Number picker UI (single auto, multi explicit, none manual) | 2 | VOICE-030 | Multi-number requires explicit selection |
| VOICE-043 | Voice timeline cards + status badges + duration | 1-2 | VOICE-025 | Lifecycle visible in ticket thread |
| VOICE-044 | Recording attachment playback/download UX | 1-2 | VOICE-023 | Recording access from ticket message/session |

### E5: AI Voice Actions in 6esk
| ID | Work Item | Estimate | Depends On | Acceptance |
|---|---|---:|---|---|
| VOICE-050 | `GET /api/agent/v1/tickets/{ticketId}/call-options` | 1-2 | VOICE-030 | Agent can discover candidates and selection requirement |
| VOICE-051 | Extend `POST /api/agent/v1/actions` with `initiate_call` | 2 | VOICE-050, VOICE-031 | Action supported with deterministic outcomes |
| VOICE-052 | Add integration capability gate `allowVoiceActions` | 1 | VOICE-051 | AI call rejected without capability |
| VOICE-053 | Add voice policy enforcement (`hours`, `confirmation`, caps) | 1-2 | VOICE-052 | Policy blocks return `blocked` with clear reason |
| VOICE-054 | Emit agent outbox events for voice lifecycle | 1 | VOICE-051 | `ticket.call.*` events delivered through outbox |
| VOICE-055 | AI voice action tests (unit + integration) | 1-2 | VOICE-054 | Ambiguous-number calls blocked without explicit candidate |

### E6: Venus Voice Plugin Track
| ID | Work Item | Estimate | Depends On | Acceptance |
|---|---|---:|---|---|
| VENUS-100 | Add `sixeskVoiceClient` (typed client + error model) | 2 | VOICE-051 | Typed client supports call-options/initiate-call |
| VENUS-101 | Register tools (`sixesk_get_ticket_call_options`, `sixesk_initiate_ticket_call`) | 1-2 | VENUS-100 | Tools callable by agent runtime |
| VENUS-102 | Tool policy layer (selection-required, consent, retryability) | 2-3 | VENUS-101 | Non-retryable errors handled deterministically |
| VENUS-103 | Webhook reconciliation for `ticket.call.*` events | 2-3 | VOICE-054 | Workflow state updates from call lifecycle events |
| VENUS-104 | End-to-end validation in staging with 6esk | 1-2 | VENUS-103 | AI call flow passes staging checklist |

### E7: Analytics + Hardening + Rollout
| ID | Work Item | Estimate | Depends On | Acceptance |
|---|---|---:|---|---|
| VOICE-070 | Analytics API updates (overview/volume include voice) | 2 | VOICE-022, VOICE-031 | Voice inbound/outbound and outcome metrics available |
| VOICE-071 | Analytics UI updates for voice KPIs | 1-2 | VOICE-070 | Dashboard panels show voice trends |
| VOICE-072 | PII redaction for phone and call payload logging | 1-2 | VOICE-020 | Logs redacted and policy-compliant |
| VOICE-073 | Dead-letter handling + admin inspection endpoint | 2 | VOICE-024, VOICE-032 | Poison events discoverable and recoverable |
| VOICE-074 | Load + failure injection tests (webhook replay/outbox retry) | 2-3 | VOICE-073 | Meets reliability thresholds |
| VOICE-075 | Pilot runbook + rollout checklist + rollback playbook | 1-2 | VOICE-074 | Ops docs approved and rehearsed |

## Critical Path
1. E0 policy/provider lock
2. E1 schema + channel refactor
3. E2 inbound + E3 outbound core
4. E4 human UX and E5 AI endpoints
5. E7 hardening and pilot

## Suggested Sprint Cut (6-8 Weeks)
- Sprint 1:
  - E0 complete
  - VOICE-010 to VOICE-013
- Sprint 2:
  - VOICE-014 to VOICE-026
- Sprint 3:
  - VOICE-030 to VOICE-035
  - VOICE-040 to VOICE-042
- Sprint 4:
  - VOICE-043 to VOICE-055
  - VENUS-100 to VENUS-102
- Sprint 5:
  - VENUS-103 to VENUS-104
  - VOICE-070 to VOICE-073
- Sprint 6:
  - VOICE-074 to VOICE-075
  - pilot, stabilization, rollout decision

## Go/No-Go Criteria
- `selection_required` behavior verified for both human and AI flows.
- Recording artifacts consistently attach to correct ticket/session.
- Idempotency verified for inbound/status/recording webhooks.
- Outbound duplicate call rate below 0.5% in pilot.
- Call webhook signature failure rate below 2% for sustained 24h.
