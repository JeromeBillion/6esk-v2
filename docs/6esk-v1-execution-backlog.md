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
| 5 | Voice capability | Real provider adapter for outbound dial execution (`VOICE-033`) | `done` | `6esk` now owns direct Twilio outbound execution and no longer depends on `6ex` for telephony delivery |
| 6 | Voice capability | Callback correlation for status, recording, and transcript events | `in_progress` | `6esk` now owns Twilio status/recording callbacks directly, stores canonical artifacts in its own R2, and has the first managed STT backend wired behind `managed_http`; live provider rehearsal is still required |
| 7 | Voice capability | Transcript-derived AI outputs (summary, resolution note, QA flags, action items) | `done` | `6esk` now persists transcript-AI jobs, dispatches managed analysis, stores derived artifacts separately from the raw transcript, and surfaces QA only in Admin/Analytics |
| 8 | Voice capability | Production call rollout hardening and policy validation | `in_progress` | Runbooks now reflect the real desk-owned Twilio path, `6esk`-owned artifact storage, and mandatory transcripts; pilot and outage drills still need to be executed with live credentials |
| 9 | Voice capability | Replace fixed operator bridge target with in-platform queue routing | `in_progress` | Customer calls now ring inside `6esk`, routing is sequential with operator reservation and pass-onward progression, and the remaining work is deeper fairness/team policy hardening plus live-provider validation |
| 10 | Voice capability | Add in-platform ringing controls and in-call operator state | `done` | Operators now ring in-browser, can answer or pass onward, and the desk shows active call state without exposing a desk-side drop action |
| 11 | Live operator experience | Add operator presence states (`online`, `away`, `offline`) | `done` | Presence is persisted and already drives voice eligibility and desk availability |
| 12 | Live operator experience | Add popup notifications and tones for email, WhatsApp, and calls | `done` | Channel-aware popups and real audio assets are wired for support email, inbox email, WhatsApp, and incoming calls |
| 13 | Live operator experience | Add real-time/near-real-time desk refresh | `done` | Shared desk snapshot polling refreshes Support and Mail without manual reload while the tab is active |
| 14 | Cross-channel merge vision | Redesign merge/link model for cross-channel linkage | `done` | `linked_case` is now the first-class non-destructive cross-channel model in Support, Merge Reviews, and Venus handoff policy |
| 15 | Cross-channel merge vision | Implement compatibility rules, preflight, and review semantics | `done` | Cross-channel merge now preflights into link semantics, same-channel hard merge stays separate, and operator-linked cases are surfaced in the Support right rail |
| 16 | Deep 6ex integration | Venus/6ex ticket creation hardening + 6ex context integration | `done` | Trusted `6ex` create flows persist `external_profile`, `profile_lookup`, identity-resolution events, and external-user link cache updates; the remaining work is no longer ticket-create hardening |
| 17 | Deep 6ex integration | 6ex customer identity resolution integration | `done` | Trusted profile matches now promote existing identity-linked customers, and contradictory upstream identities now preserve the canonical 6esk customer with explicit conflict metadata instead of rebinding ownership |
| 18 | Product hardening | Expand audit/replay/retry coverage for live channel operations | `done` | Voice, WhatsApp, and AI outbox paths now support operator-visible failed queues, targeted retry, stale-processing recovery, and audited recovery triggers |
| 19 | Live operator experience | Add recoverable personal inbox drafts with a Drafts tab | `missing` | Started-but-unsent personal emails must persist as drafts and remain resumable from a dedicated Inbox Drafts view |

## Remaining v1 Focus

### Open v1 items
- live callback rehearsal against the chosen Twilio deployment from `6esk`
- finalize the `6esk`-owned recording-to-R2 and transcript pipeline against live provider callbacks and Deepgram STT credentials
- pilot hardening and outage drills with real credentials
- harden queue-routing policy further if live traffic requires richer fairness, team, or skill-based routing beyond the current sequential reservation model
- add recoverable personal inbox drafts and a dedicated Drafts tab/view

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
