# 6esk v1 Execution Backlog

This backlog converts [6esk-v1-completion-roadmap.md](C:\Users\choma\Desktop\6esk\docs\6esk-v1-completion-roadmap.md) into an execution sequence against the current codebase.

## Status Keys
- `done`
- `in_progress`
- `missing`
- `blocked_external`

## Current Sequence

| Order | Workstream | Requirement | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Modular service entitlements | Add workspace-level module storage and admin controls | `done` | Workspace storage, admin API, Admin UI, and demo-state support landed |
| 2 | Modular service entitlements | Enforce module guards in ticket creation and outbound channel routes | `done` | Guards now cover create/send/reply/call/resend paths |
| 3 | Modular service entitlements | Extend entitlement guards into AI action execution paths | `done` | Agent action entry is blocked when AI automation is disabled; channel-specific AI hardening can still deepen later |
| 4 | Modular service entitlements | Add entitlement-aware metering hooks | `done` | Usage events now land on real create/send/reply/call/AI action paths and are surfaced in Admin workspace usage |
| 5 | Voice capability | Real provider adapter for outbound dial execution (`VOICE-033`) | `done` | `6esk` now delivers through `http_bridge`, and `6ex` now owns a Twilio-capable outbound bridge plus recording relay |
| 6 | Voice capability | Callback correlation for status, recording, and transcript events | `in_progress` | `6ex` now relays status/recording/transcript callbacks back into `6esk`; live provider rehearsal is still required |
| 7 | Voice capability | Production call rollout hardening and policy validation | `in_progress` | Runbooks now reflect the real bridge path; pilot and outage drills still need to be executed with live credentials |
| 8 | Cross-channel merge vision | Redesign merge/link model for cross-channel linkage | `done` | `linked_case` is now the first-class non-destructive cross-channel model in Support, Merge Reviews, and Venus handoff policy |
| 9 | Cross-channel merge vision | Implement compatibility rules, preflight, and review semantics | `done` | Cross-channel merge now preflights into link semantics, same-channel hard merge stays separate, and operator-linked cases are surfaced in the Support right rail |
| 10 | Deep 6ex integration | Venus/6ex ticket creation hardening + 6ex context integration | `done` | Trusted `6ex` create flows persist `external_profile`, `profile_lookup`, identity-resolution events, and external-user link cache updates; the remaining work is no longer ticket-create hardening |
| 11 | Deep 6ex integration | 6ex customer identity resolution integration | `done` | Trusted profile matches now promote existing identity-linked customers, and contradictory upstream identities now preserve the canonical 6esk customer with explicit conflict metadata instead of rebinding ownership |
| 12 | Product hardening | Expand audit/replay/retry coverage for live channel operations | `done` | Voice, WhatsApp, and AI outbox paths now support operator-visible failed queues, targeted retry, stale-processing recovery, and audited recovery triggers |

## Remaining v1 Focus

### Non-telephony items still open
- no material non-telephony v1 blockers remain in the current backlog

### Remaining telephony items
- live callback rehearsal against the chosen Twilio deployment
- pilot hardening and outage drills with real credentials

## Completed Build Slices

### Slice A: Entitlement Foundations
- persistence model for workspace modules
- admin API for workspace module configuration
- admin workspace UI for module toggles
- demo-mode support for workspace modules
- first enforcement in:
  - `/api/tickets/create`
  - `/api/email/send`
  - `/api/whatsapp/send`

### Slice Exit Criteria
- Admin can turn core billable modules on/off
- channel-initiation routes respect those toggles
- demo mode exposes and persists the same configuration shape
- the feature becomes a real source of truth rather than UI-only settings

### Slice B: Cross-Channel Linkage
- `linked_case` preflight and execution endpoints
- merge review alignment for non-destructive cross-channel linkage
- Support right-rail linked-case surfacing and navigation
- Venus downgrade from unsafe cross-channel merge to linked-case flow

### Slice C: Usage Metering
- usage-event persistence for billable modules
- Admin workspace usage summary API
- Admin workspace usage card
- route-level usage accounting for human and AI channel actions
