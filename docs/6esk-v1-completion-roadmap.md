# 6esk v1 Completion Roadmap (6ex Custom Platform)

## Purpose
`6esk v1` is the proof-of-capability build for `6ex`: a proprietary, custom CRM/support platform owned by `6ex`, exercised against real `6ex` customers and workflows until the product works end-to-end.

This roadmap is not the SaaS commercialization plan. It is the completion plan for the internal/custom product so the system actually delivers the vision already implied by the UI, mock state, and landing narrative.

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
- workspace-level module entitlements and runtime guards
- first-pass entitlement-aware usage metering surfaced in Admin
- non-destructive cross-channel `linked_case` operator flow in Support
- live operator presence with `online` / `away` / `offline`
- browser-based desk calling with in-platform ringing, answer, pass-onward, and in-call state
- real-time desk snapshot polling plus channel-aware popups and tones for email, WhatsApp, and calls

Still incomplete or intentionally blocked:
- live provider callback rehearsal and production rollout validation
- final pilot hardening against the chosen Twilio deployment
- remaining open work is now overwhelmingly rollout validation plus deeper queue-policy hardening rather than missing core provider code

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
6. Harden in-platform queue-aware operator routing with sequential offer policy, pass-onward progression, and fair operator ordering inside `6esk`.
7. Deepen explicit operator state visibility so routing and supervision can distinguish ringing, available, in-call, away, and offline desk operators.
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

## Execution Order
### Phase 1: finish product-critical blockers
- voice rollout validation on the real `6esk -> Twilio` path
- Venus/6ex ticket creation hardening + `6ex` context integration
- `6ex` customer identity integration

Note:
- the real provider adapter is now implemented directly in `6esk` for Twilio outbound/status/recording ownership
- the remaining voice task is no longer basic provider ownership; it is completion of the real desk-side ringing/answer flow plus rollout validation

### Phase 2: modularize the platform
- entitlement schema
- runtime capability guards
- module-based admin/config model
- metering hooks

### Phase 3: harden for real operation
- telemetry expansion
- failure drills
- rollback paths
- audit completeness
- pilot signoff

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
