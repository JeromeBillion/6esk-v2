# 6esk v1 Completion Roadmap (6ex Custom Platform)

## Purpose
`6esk v1` is the proof-of-capability build for `6ex`: a proprietary, custom CRM/support platform owned by `6ex`, exercised against real `6ex` customers and workflows until the product works end-to-end.

This roadmap is not the SaaS commercialization plan. It is the completion plan for the internal/custom product so the system actually delivers the vision already implied by the UI, mock state, and landing narrative.

Follow-on roadmap after `v1`:
- [6esk v2 Commercialization Roadmap](./6esk-v2-commercialization-roadmap.md)

## Product Definition
`6esk v1` should prove that a single support operating surface can run:
- Email
- WhatsApp
- Voice
- Tickets
- AI drafts
- AI agent actions
- Merge reviews
- Admin and operations recovery

for `6ex`, with real integrations, real customer identity resolution, and real workflow ownership.

## Explicit Scope
In scope:
- finish voice product capability
- unblock the currently blocked WhatsApp/cross-channel merge model
- complete deep `6ex` integration
- introduce modular service entitlements so the same codebase can later become commercial
- harden operations, telemetry, audit, and recovery around the live product

Out of scope:
- public SaaS commercialization
- self-serve onboarding
- public pricing/billing
- multi-tenant architecture
- v2 trust-center / legal website work
- landing page as a product requirement

Note:
- the current landing page is a `v2` asset, not a `v1` requirement

## Current State
Strongly in place already:
- support, mail, analytics, admin, merge-review, and customer-history surfaces
- omnichannel support timeline model
- AI drafts and action surfaces
- queue operations and bulk actions baseline
- merge-review workflow
- call analytics and ops baseline
- real email inbound/outbound flow through `6esk` for support and personal inboxes
- personal mailbox states now behave like a real desk mailbox:
  - Inbox
  - Sent
  - Outbox
  - Drafts
- recoverable email drafts plus verified outbound progression through Drafts -> Outbox -> Sent
- workspace-level module entitlements and runtime guards
- first-pass entitlement-aware usage metering surfaced in Admin
- non-destructive cross-channel `linked_case` operator flow in Support
- live operator presence with `online` / `away` / `offline`
- browser-based desk calling with in-platform ringing, answer, pass-onward, and in-call state
- real-time desk snapshot polling plus channel-aware popups and tones for email, WhatsApp, and calls
- managed STT orchestration is wired, with Deepgram as the current `v1` transcript provider path
- transcript-derived AI outputs and QA analysis are wired, with QA surfacing in Admin/Analytics only

Still incomplete or intentionally blocked:
- live provider callback rehearsal and production rollout validation
- live Deepgram transcript validation against real call recordings in the live desk flow
- final pilot hardening against the chosen Twilio deployment
- Twilio South Africa number acquisition or porting may remain blocked until the business/incorporation path is ready
- remaining open work is now overwhelmingly rollout validation, drills, and optional queue-policy refinement rather than missing core provider code

## v1 Success Criteria
`6esk v1` is complete only when all of the following are true:
1. `6ex` can run customer support end-to-end in `6esk` across email, WhatsApp, tickets, and voice.
2. Voice works with a real provider, not only mock or partial queue simulation.
3. Cross-channel support history and merge behavior match the operator experience promised in the UI.
4. Venus can create and act on tickets through supported APIs where required by the `6ex` operating model, with hardened contracts and full context propagation.
5. `6esk` can reliably identify `6ex` customers using approved integration boundaries.
6. Feature availability can be switched on/off cleanly by package or workspace entitlement.
7. Operations can observe, recover, retry, and audit every major channel flow.
8. Operators can work the platform as a live desk, with clear online/offline/away presence, queue notifications, and real-time updates for new work.
9. Voice queue behavior matches real support expectations: customer calls route into `6esk`, operators ring and answer inside the desk, skip/pass onward is supported, in-call presence is visible, and there is no operator-driven customer drop action.
10. Personal inbox behavior matches normal operator expectations: Inbox, Sent, Outbox, and Drafts each reflect distinct states, and unfinished email composition is preserved as recoverable drafts instead of being lost.

## Workstream A: Finish Voice Capability
Source of truth: [call-capabilities-backlog.md](C:\Users\choma\Desktop\6esk\docs\call-capabilities-backlog.md)

### Priority Items
1. Run full staging and pilot validation from human path and AI path against the live Twilio-backed `6esk` voice path.
2. Validate provider call ID correlation across outbound queue, status callbacks, recordings, and transcripts.
3. Close any remaining live-environment gaps in call recording playback/download and transcript timing.
4. Finalize consent, policy, and blocking behaviors for live calling.
5. Rehearse rollback and outage drills with the real provider path enabled.
6. Validate the current in-platform queue-aware operator routing against live traffic and deepen policy only if real traffic shows the current sequential reservation model is insufficient.
7. Validate explicit operator state visibility so routing and supervision can distinguish ringing, available, in-call, away, and offline desk operators under real load.
8. Keep browser/platform answer and skip-pass controls trustworthy under retry/failover paths and explicitly forbid operator-side call drop as a supported queue action.

### Required Deliverables
- real provider adapter wired into `call_outbox_events`
- stable callback reconciliation for status, recording, and transcript events
- `6esk`-owned Twilio outbound execution plus `6esk`-owned recording and transcript storage in `6esk` R2 buckets
- mandatory transcript pipeline attached to the correct ticket/session, even if transcript generation is asynchronous and handled outside Twilio
- `6esk` STT orchestration owned inside `6esk`, with managed STT first and self-hosting treated as a later optimization, not a `v1` blocker
- first managed STT backend wired behind `managed_http` so provider selection stays isolated from the rest of the call pipeline
- raw transcript remains the canonical call record; AI-generated summary, resolution note, QA flags, and action items are separate derived artifacts layered on top of that transcript
- AI QA is a required `v1` voice outcome, not a later nice-to-have; the system must be able to flag low-confidence handling, missed resolution steps, or other operator-review signals from the transcript
- QA signals must surface in Admin/metrics dashboards only; Support remains focused on the raw transcript and operational ticket state
- full audit/event provenance for call lifecycle
- operator-visible failure states and retry controls
- live queue-aware call assignment inside `6esk` with operator reservation, pass-onward progression, and fair operator ordering instead of a single hard-coded operator bridge target
- ringing state with in-platform answer and pass-on controls, plus live roster visibility
- in-call state visible in the UI so teammates can see who is busy
- no explicit operator-side drop action for queued/ringing customer calls
- pilot checklist executed against `6ex` traffic or staging mirror
- customer-facing support numbers route into `6esk`, not to an operator's personal phone as the normal support path
- browser-native/softphone handling is the target desk model for `v1`, even if temporary PSTN bridging exists during migration

### Exit Criteria
- inbound and outbound voice both work in a real environment
- recordings and transcripts land on the correct ticket/session
- transcript-derived AI outputs (summary, resolution note, QA flags, action items) land on the correct ticket/session and remain traceable back to the raw transcript
- QA flags and review counts are visible in Admin/Analytics without leaking into the Support operator surface
- AI and human call initiation both honor policy rules
- customer calls ring inside `6esk` and operators can receive, answer, or pass them from the queue without silently dropping customer calls
- operator presence and in-call state are visible and respected by routing
- no critical mock-only assumptions remain in the main call path
- no normal support-call flow depends on dialing or bridging to an operator's personal phone number
- queue progression is deterministic enough that the same online operator is not repeatedly first unless desk state actually warrants it

## Workstream B: Unblock WhatsApp / Cross-Channel Merge Vision
Current constraint: [merge-feature-roadmap.md](C:\Users\choma\Desktop\6esk\docs\merge-feature-roadmap.md) still blocks destructive cross-channel merge, but now supports a non-destructive `linked_case` path.

### Problem
The current system still treats some merge behavior as channel-bounded, while the product vision and operator workflow increasingly assume:
- one customer
- many interactions
- multiple dominant channels
- one coherent operating history

### Required Design Shift
We need to stop thinking only in terms of `ticket merge` and instead define:
1. customer-level interaction unification
2. conversation/ticket linkage across channels
3. provenance-safe attachment of one channel flow beneath another without losing audit truth

### Roadmap Items
1. Redesign merge domain model for cross-channel linkage.
2. Distinguish these operations clearly:
   - same-channel irreversible ticket merge
   - cross-channel linked-case linkage
   - customer merge
3. Introduce preflight rules for cross-channel compatibility and provenance.
4. Update support timeline/header logic so dominant ticket/channel can change while customer history remains coherent.
5. Ensure audit, merge review, undo boundaries, and conflict handling are explicit.
6. Extend AI merge actions only after human merge semantics are stable.

### Exit Criteria
- WhatsApp and email/call flows can be unified in a way that matches the operator experience promised by the UI
- no silent provenance loss
- merge review queue supports the new decision model, including `linked_case`
- customer history and right-rail interaction history remain truthful after merge/link actions

## Workstream C: Modular Service Entitlements
This is the most important bridge from `v1` to `v2`.

### Goal
A client must be able to buy only the modules they want, and the platform must enforce that cleanly.

### Core Principle
Feature access cannot remain implicit in UI visibility or environment variables. It must become an explicit entitlement model enforced in:
- backend actions
- agent actions
- webhooks/connectors
- UI surfaces
- metering
- pricing/billing later in `v2`

### Proposed Entitlement Model
Core platform (included, non-billable as standalone modules later):
- support workspace shell
- analytics
- admin
- ops
- human-to-6esk vanilla webchat

Billable modules:
- email
- WhatsApp
- voice
- AI automation
- Venus-derived orchestration module
- BYO AI provider connector mode

### Rules
- if `AI automation` is off, no autonomous text/voice agent actions should execute
- if `voice` is off, no voice UI, API initiation, or webhook processing should be active for that tenant/workspace
- if `WhatsApp` is off, WhatsApp send/resend/template features must be disabled at runtime
- if `email` is off, mailbox sending and inbox controls must be disabled at runtime
- if `Venus orchestration` is off, 6esk must still function with no Venus dependency
- if `BYO AI` is enabled, token-cost pass-through changes, but orchestration/runtime controls remain ours

### Implementation Items
1. Add a formal entitlement schema and storage model.
2. Build capability guards shared across API, agent actions, workers, and UI.
3. Add per-workspace/module enablement in admin.
4. Add metering hooks per billable module and per AI cost domain.
5. Remove hidden assumptions that `6ex` always has all features.

### Exit Criteria
- turning modules on/off changes real platform behavior safely
- no hidden hard dependency on channels or AI features remains
- this model is sufficient to become the commercial packaging backbone in `v2`

Current progress:
- entitlement storage, Admin controls, and runtime guards are in place
- first-pass usage metering is in place for the main human and AI action paths
- remaining work is hardening coverage and using that data for later billing/commercial logic

## Workstream D: Deep 6ex Integration
`6esk v1` is still custom software for `6ex`. It should integrate like a real internal platform, not like a generic third-party product.

### Required Integration Outcomes
1. Venus/`6ex` can create tickets from `6ex` into `6esk` through hardened, versioned contracts.
2. `6esk` can resolve `6ex` customers cleanly through approved integration boundaries.
3. `6esk` can operate as the support control plane while `6ex` remains the source of truth where appropriate.
4. Integration boundaries are explicit, versioned, and testable.

### Concrete Gaps To Close
1. Harden existing Venus/`6ex` -> `6esk` ticket creation and escalation contracts.
2. Expand customer identity lookup and reconciliation against `6ex` data.
3. Enrich tickets with `6ex` customer context, source-system metadata, and deterministic correlation identifiers.
4. Propagate the `6esk` events that `6ex` actually needs back across the boundary.
5. Remove any fragile direct assumptions in favor of stable integration clients/contracts.

Current progress:
- trusted `6ex` -> `6esk` ticket creation is already present
- `6esk` now owns direct Twilio outbound execution, Twilio webhook handling, and voice artifact ingress without routing telephony through `6ex`
- `6esk` already delivers lifecycle events directly to Venus where needed
- `6esk` remains the storage owner for call artifacts; even when new Cloudflare R2 buckets are created, they are `6esk` buckets, not `6ex` buckets
- trusted inbound `6ex` create flows now persist customer identity enrichment and external-user link cache updates inside `6esk`
- trusted profile matches now promote existing identity-linked customers instead of forking duplicate registered records
- true upstream identity contradictions now keep the canonical `6esk` customer, refuse external rebinds, and record explicit conflict metadata/events instead of silently rewriting ownership
- we explicitly rejected broad `6esk` state mirroring back into `6ex` for `v1`

Lean-build rule:
- `6esk` remains the CRM system of record
- `6ex` should not mirror ticket/message/call state unless a concrete `6ex` feature requires it
- Venus can consume `6esk` lifecycle events directly without forcing `6ex` to become a shadow CRM

### Architecture Rule
Even for `v1`, do not solve this with uncontrolled direct database coupling unless it is deliberately isolated behind a single access layer. If `6esk` reads `6ex` data directly, that must still be treated like an integration module with:
- ownership
- schema contract
- retry behavior
- observability
- fallback behavior

### Exit Criteria
- Venus/`6ex` ticket creation is reliable and context-rich
- `6esk` identifies `6ex` customers reliably
- customer and ticket state stay coherent across the two systems
- no undocumented “magic coupling” remains

## Workstream E: Product Hardening For Real Use
This is not just DevOps. It is product-operability.

### Required Areas
1. audit completeness across all channels
2. webhook reliability and replay handling
3. dead-letter and retry inspection
4. tenant/workspace-safe secrets and capability configuration
5. backup/restore verification for CRM-critical data
6. channel-specific failure drills and rollback runbooks
7. stronger telemetry around AI actions, message delivery, and call outcomes
8. live operator presence model across the workspace
9. real-time desk updates for new email, WhatsApp, and call events
10. operator notifications with channel-aware popups and tones
11. browser-native ringing and answer flow for support calls, instead of operator PSTN/mobile bridging as the normal desk path

### Code Review Findings To Close
Source: full `6esk` system review on 2026-04-26. These are `v1` hardening blockers or near-blockers before live operation.

1. Fix inbound email profile-link transaction ownership.
   - Risk: matched inbound email can fail when `storeInboundEmail` inserts a new ticket inside a transaction, then calls `upsertExternalUserLink` through the global pool before the ticket commit.
   - Required outcome: external-user link writes use the same transaction client or run after commit without breaking FK integrity.

2. Make webhook authentication fail closed in production.
   - Risk: call webhooks, email inbound, and WhatsApp inbound can accept unauthenticated traffic when their secrets are unset; call artifact endpoints can also fetch arbitrary provider URLs if authentication is misconfigured.
   - Required outcome: production rejects missing webhook secrets, keeps any local/dev bypass explicit, and artifact fetches enforce provider allowlists, timeouts, size limits, and safe content-type handling.

3. Fix Twilio voice queue callback signature validation.
   - Risk: queue callback URLs include required query parameters, but validation reconstructs a path-only URL, so valid Twilio callbacks can be rejected.
   - Required outcome: signature validation uses the exact public callback URL Twilio signed, including queue query parameters, with a regression test.

4. Split or harden non-transactional concurrent-index migrations.
   - Risk: migration `0033` contains multiple `CREATE INDEX CONCURRENTLY` statements executed as one non-transactional query.
   - Required outcome: concurrent index statements are applied individually, or each concurrent index lives in its own migration.

5. Add provider-level idempotency or duplicate suppression to outbound delivery.
   - Risk: email, WhatsApp, and call outboxes are at-least-once; a crash after provider success but before local `sent` marking can duplicate customer contact.
   - Required outcome: each provider send path has a stable idempotency key where supported, plus duplicate detection/reconciliation where provider idempotency is unavailable.

6. Revoke active sessions after password reset.
   - Risk: password reset updates the password and marks the token used, but existing sessions remain valid until expiry.
   - Required outcome: successful password reset deletes existing sessions for the target user and records the session revocation in audit logs.

### Live Operator Experience Requirements
The platform should feel like a live operating surface, not a static backoffice page. `v1` therefore also requires:
- operator presence states:
  - online
  - away
  - offline
- notification controls tied to presence so active operators can receive pop-up alerts for:
  - support emails
  - inbox emails
  - WhatsApp messages
  - incoming/ringing calls
- ringtone or equivalent audible alert for queued/ringing calls
- real-time or near-real-time queue refresh so new work appears without manual reload
- clear in-call state in the UI so the team can see who is currently busy on voice
- support calls route into the desk UI itself; the normal operator experience is platform ringing/answering, not a call to the operator's personal handset
- personal inbox composition behaves like a real mailbox, including:
  - recoverable unsent drafts
  - a dedicated Drafts view/tab in Inbox
  - draft persistence when an operator starts an email and leaves before sending
  - clear separation between Drafts, Sent, Inbox, and any pending outbound queue state

### Voice Queue Rule
For `v1`, customer calls should not be operator-droppable from the queue surface.
Operators may:
- answer
- pass/skip onward

Operators may not:
- actively drop the customer's call from the queue on behalf of the customer

If the customer abandons or hangs up, that should be reflected as a provider/customer-side outcome rather than a desk-side drop action.

### Exit Criteria
- ops can explain and recover every failed send/call/merge path
- retry/dead-letter handling is operator-usable, not only developer-usable
- staging drills mirror production enough to de-risk rollout
- personal inbox drafts survive partial composition and can be resumed from a dedicated Drafts view

Current progress:
- voice already had failed-event, retry, and dead-letter operator tooling
- WhatsApp outbox now has stale-processing recovery, failed-event inspection, targeted retry, and audited admin recovery actions
- AI agent outbox now has stale-processing recovery, failed-event inspection, targeted retry, and audited admin recovery actions
- desk presence, browser-native ringing/answer/pass controls, and in-call state are already live in the product
- channel-aware popups and tones are already live for support email, inbox email, WhatsApp, and calls
- real-time desk snapshot polling is already live and refreshes Support/Mail without manual reload
- personal inbox drafts are already live with a dedicated Drafts view and resumable composition
- email outbox verification is already live, so outbound mail now progresses through Drafts -> Outbox -> Sent instead of bypassing delivery state

## Execution Status And Order
This section is the single canonical `v1` execution backlog, keeping roadmap intent, implementation status, and remaining hardening work together.

### Status Keys
- `done`
- `in_progress`
- `missing`
- `blocked_external`

### Current Sequence
| Order | Workstream | Requirement | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Modular service entitlements | Add workspace-level module storage and admin controls | `done` | Workspace storage, admin API, Admin UI, and demo-state support landed |
| 2 | Modular service entitlements | Enforce module guards in ticket creation and outbound channel routes | `done` | Guards now cover create/send/reply/call/resend paths |
| 3 | Modular service entitlements | Extend entitlement guards into AI action execution paths | `done` | Agent action entry is blocked when AI automation is disabled; channel-specific AI hardening can still deepen later |
| 4 | Modular service entitlements | Add entitlement-aware metering hooks | `done` | Usage events now land on real create/send/reply/call/AI action paths and are surfaced in Admin workspace usage |
| 5 | Voice capability | Real provider adapter for outbound dial execution (`VOICE-033`) | `done` | `6esk` now owns direct Twilio outbound execution and no longer depends on `6ex` for telephony delivery |
| 6 | Voice capability | Callback correlation for status, recording, and transcript events | `in_progress` | `6esk` now owns Twilio status/recording callbacks directly, stores canonical artifacts in its own R2, and has the first managed STT backend wired behind `managed_http`; live provider rehearsal is still required |
| 7 | Voice capability | Transcript-derived AI outputs: summary, resolution note, QA flags, and action items | `done` | `6esk` persists transcript-AI jobs, dispatches managed analysis, stores derived artifacts separately from the raw transcript, and surfaces QA only in Admin/Analytics |
| 8 | Voice capability | Production call rollout hardening and policy validation | `in_progress` | Runbooks reflect the real desk-owned Twilio path, `6esk`-owned artifact storage, and mandatory transcripts; pilot and outage drills still need live credentials |
| 9 | Voice capability | Replace fixed operator bridge target with in-platform queue routing | `in_progress` | Customer calls now ring inside `6esk`; routing is sequential with operator reservation and pass-onward progression; remaining work is deeper fairness/team policy hardening only if live traffic requires it |
| 10 | Voice capability | Add in-platform ringing controls and in-call operator state | `done` | Operators now ring in-browser, can answer or pass onward, and the desk shows active call state without exposing a desk-side drop action |
| 11 | Live operator experience | Add operator presence states (`online`, `away`, `offline`) | `done` | Presence is persisted and already drives voice eligibility and desk availability |
| 12 | Live operator experience | Add popup notifications and tones for email, WhatsApp, and calls | `done` | Channel-aware popups and real audio assets are wired for support email, inbox email, WhatsApp, and incoming calls |
| 13 | Live operator experience | Add real-time/near-real-time desk refresh | `done` | Shared desk snapshot polling refreshes Support and Mail without manual reload while the tab is active |
| 14 | Cross-channel merge vision | Redesign merge/link model for cross-channel linkage | `done` | `linked_case` is now the first-class non-destructive cross-channel model in Support, Merge Reviews, and Venus handoff policy |
| 15 | Cross-channel merge vision | Implement compatibility rules, preflight, and review semantics | `done` | Cross-channel merge now preflights into link semantics, same-channel hard merge stays separate, and operator-linked cases are surfaced in the Support right rail |
| 16 | Deep 6ex integration | Venus/6ex ticket creation hardening and 6ex context integration | `done` | Trusted `6ex` create flows persist `external_profile`, `profile_lookup`, identity-resolution events, and external-user link cache updates; remaining work is no longer ticket-create hardening |
| 17 | Deep 6ex integration | 6ex customer identity resolution integration | `done` | Trusted profile matches promote existing identity-linked customers, and contradictory upstream identities preserve the canonical 6esk customer with explicit conflict metadata instead of rebinding ownership |
| 18 | Product hardening | Expand audit/replay/retry coverage for live channel operations | `done` | Voice, WhatsApp, and AI outbox paths support operator-visible failed queues, targeted retry, stale-processing recovery, and audited recovery triggers |
| 19 | Live operator experience | Add recoverable personal inbox drafts with a Drafts tab | `done` | Drafts persist for compose/reply/forward and move through Drafts -> Outbox -> Sent |
| 20 | Product hardening | Close 2026-04-26 code review hardening findings | `in_progress` | Transaction ownership, webhook fail-closed behavior, Twilio queue signature validation, concurrent-index migration safety, outbound idempotency, and password-reset session revocation remain to close |

### Remaining v1 Focus
- live callback rehearsal against the chosen Twilio deployment from `6esk`
- finalize the `6esk`-owned recording-to-R2 and transcript pipeline against live provider callbacks and Deepgram STT credentials
- close the code review hardening findings listed under Workstream E
- pilot hardening and outage drills with real credentials
- harden queue-routing policy further only if live traffic requires richer fairness, team, or skill-based routing beyond the current sequential reservation model

### Completed Build Slices
Slice A: entitlement foundations
- persistence model for workspace modules
- admin API for workspace module configuration
- admin workspace UI for module toggles
- demo-mode support for workspace modules
- first enforcement in `/api/tickets/create`, `/api/email/send`, and `/api/whatsapp/send`

Slice A exit criteria
- Admin can turn core billable modules on or off
- channel-initiation routes respect those toggles
- demo mode exposes and persists the same configuration shape
- the feature becomes a real source of truth rather than UI-only settings

Slice B: cross-channel linkage
- `linked_case` preflight and execution endpoints
- merge review alignment for non-destructive cross-channel linkage
- Support right-rail linked-case surfacing and navigation
- Venus downgrade from unsafe cross-channel merge to linked-case flow

Slice C: usage metering
- usage-event persistence for billable modules
- Admin workspace usage summary API
- Admin workspace usage card
- route-level usage accounting for human and AI channel actions

### Near-Term Execution Phases
Phase 1: finish live-provider validation
- voice rollout validation on the real `6esk -> Twilio` path
- live transcript validation on the real `Deepgram -> 6esk` path
- transcript-derived QA validation on the configured global AI provider path

Phase 2: close product hardening risks
- fix code review findings before live operation
- verify webhook authentication and artifact-ingress behavior with production-like env
- prove outbound delivery duplicate-suppression behavior under crash/retry drills

Phase 3: finish operational drills
- outage drill
- rollback drill
- pilot signoff
- queue-policy refinement only if live traffic shows a real need

Phase 4: close evidence and rollout proof
- capture final runbook evidence
- close any remaining live-environment transcript/callback gaps
- confirm no mock-only assumptions remain in the real support path

## v1 Definition Of Done
`6esk v1` is done when:
- `6ex` can run serious support work in `6esk`
- AI can participate meaningfully, including voice where enabled
- channels can be unified in a way that matches the vision already sold visually
- Venus and `6ex` integrations are real, not aspirational
- feature modules can be switched on/off safely
- operational recovery paths are trustworthy

## Notable Non-Scope Reminder
The landing page is a `v2` go-to-market artifact. It is not evidence that `v1` is complete.
