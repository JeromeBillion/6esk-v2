# 6esk v3 Mobile Roadmap (App Store Native Product)

## Purpose
`6esk v3` is the native mobile-app version of `6esk`: an App Store / Play Store product that brings the full `v2` platform to mobile operators, managers, admins, and executives without reducing platform capability.

This is not a lightweight feature subset in the product sense. It is a lighter interaction surface for mobile hardware, but it must preserve all `v2` business capability.

## Product Thesis
`6esk v3` should prove that the full `6esk v2` operating model can work credibly on mobile:
- every serious support channel in one native mobile surface
- optional AI automation across text and voice
- mobile operators can step into live work without losing context
- managers and executives can review health, risk, and performance from mobile
- admins can control tenant, user, security, and module settings from mobile when required

## Core Rule
`v3` must have all `v2` capabilities.

That does not mean every screen should look identical to web. It means:
- no platform capability is web-only by product definition
- mobile may use different interaction patterns
- mobile may stage dense workflows differently
- mobile may gate certain high-risk actions behind confirmation or stronger auth
- but functional parity remains the goal

## Baseline Assumptions
- `v3` starts only after `v2` is stable enough to support a native client
- `v3` is a native mobile product distributed through:
  - Apple App Store
  - Google Play Store
- `v3` is tenant-aware from day one
- `v3` supports the same entitlement and packaging model as `v2`
- `v3` uses the `v2` backend/platform as the system of record
- mobile is not a sidecar app for notifications only; it is a real operating surface
- offline-aware behavior matters, but offline-first is not a license to fork core platform logic

## What "Lite" Means Here
`Lite` means:
- smaller-screen-first workflows
- task-prioritized UX
- reduced visual clutter
- stronger use of sheets, stacks, tabs, quick actions, and native gestures
- aggressive focus on actionability and responsiveness

`Lite` does not mean:
- fewer modules
- fewer channels
- fewer admin controls
- fewer AI controls
- fewer billing/tenant/security capabilities
- "web for power users, mobile for read-only"

## v3 Success Criteria
`6esk v3` is ready only when all of the following are true:
1. A tenant can operate the same modules on mobile that exist in `v2`.
2. A mobile operator can handle email, WhatsApp, voice, tickets, and AI-assisted work end to end.
3. A mobile manager can review performance, risk, SLA, QA, and queue state without needing the web app for normal oversight.
4. A mobile admin can manage tenant settings, users, roles, entitlements, and key operational controls safely.
5. Voice, notifications, and presence behave like a live desk, not a delayed inbox.
6. Mobile session/auth security is strong enough for enterprise customers.
7. Push notifications, deep linking, and background refresh are production-grade.
8. The mobile app remains aligned with `v2` capability and does not drift into a permanently reduced product.

## Product Surfaces Required In v3
All `v2` product capabilities must exist in mobile form.

### Operator Surfaces
- support workspace
- personal inbox
- shared mailboxes
- WhatsApp workspace
- voice queue and live call handling
- ticket detail and customer history
- AI drafts and AI action review
- merge review and linked-case workflows
- attachment viewing and sending
- macros, saved views, tags, and queue filters

### Manager / Team Lead Surfaces
- live queue overview
- operator presence and in-call visibility
- SLA and workload monitoring
- QA flags and transcript-derived review signals
- merge review backlog
- ticket/channel/agent analytics
- attention states and failure states

### Admin / Ops Surfaces
- users and roles
- tenant/workspace settings
- module entitlements
- security settings
- audit views
- dead-letter / retry / failure recovery surfaces
- provider health and operational runbooks
- billing/usage visibility
- AI provider and policy controls

### Executive Surfaces
- top-line health overview
- SLA / CSAT / response / resolution trends
- channel volume and labor/AI mix
- cost/risk alerting
- incident/status visibility
- tenant/commercial health where appropriate

## Workstream A: Mobile Product Architecture
### Required Platform Decisions
1. Define a single mobile client contract against the `v2` backend.
2. Build mobile-safe API/view-model boundaries for:
   - queues
   - ticket detail
   - customer detail
   - mail threads
   - WhatsApp threads
   - calls
   - analytics
   - admin controls
3. Standardize native state models for:
   - optimistic updates
   - retries
   - outbox/pending actions
   - drafts
   - background refresh
   - push-originated refresh
4. Treat deep links as first-class navigation inputs.
5. Keep business logic server-owned wherever possible so mobile does not become a second backend.

### Exit Criteria
- mobile clients consume stable `v2` contracts
- no critical workflow depends on brittle web-only payload assumptions
- mobile-specific view models do not fork business rules

## Workstream B: Native Interaction Model
### Goal
Translate the full `v2` platform into a mobile-native operating surface instead of shrinking the web UI onto a phone.

### Required UX Principles
1. Task-first navigation, not page-first navigation.
2. Fast switching between:
   - Support
   - Inbox
   - Calls
   - Analytics
   - Admin
3. Queue and thread actions must be thumb-friendly.
4. Detail views must preserve context without overwhelming small screens.
5. High-frequency actions should use:
   - bottom sheets
   - pinned quick actions
   - gesture shortcuts where safe
   - strong draft persistence

### Explicit UX Rule
Because `v3` must keep all `v2` capability, the design must not hide difficult workflows behind "desktop only" assumptions. It must redesign them for mobile properly.

### Exit Criteria
- dense `v2` workflows become usable on phones
- no major workflow requires "open web for the real action"

## Workstream C: Notifications, Presence, and Live Desk Behavior
### Goal
The mobile app must behave like a real-time desk endpoint.

### Required Capabilities
1. Native push notifications for:
   - support email
   - personal inbox email
   - WhatsApp
   - incoming calls
   - AI escalations
   - merge reviews
   - SLA/risk alerts
2. Presence model parity with `v2`:
   - online
   - away
   - offline
   - busy / in-call
3. Native notification actions where platform rules allow:
   - answer
   - mark seen
   - open thread
   - pass onward
4. Queue liveness with efficient refresh rules.
5. Device-level notification preferences and tones.

### Voice Rule
Calls to a customer-facing support number must ring inside the mobile `6esk` client just as they do in the web desk. Mobile is a first-class desk endpoint, not merely a forwarded PSTN destination.

### Exit Criteria
- mobile users can behave as live operators
- presence and queue state remain coherent across web and mobile endpoints

## Workstream D: Mobile Voice Capability
### Required Voice Outcomes
1. Native or provider-supported in-app call answer/handoff experience.
2. Queue-aware ringing and pass-onward behavior.
3. In-call UI for:
   - active customer identity
   - ticket/session context
   - mute/speaker/device controls where supported
   - transcript status
   - AI assist state
4. Call completion artifacts visible from mobile:
   - recording status
   - transcript
   - summary
   - QA flags
   - action items

### Non-Negotiable Rule
Voice on mobile must still obey the same architectural rule as web:
- customer calls route into `6esk`
- `6esk` routes operators
- no normal support flow depends on personal mobile numbers as the product model

### Exit Criteria
- mobile can participate in live call operations with the same business semantics as `v2`

## Workstream E: Mobile Inbox, Email, and Drafting
### Required Outcomes
1. Full mailbox support on mobile:
   - Inbox
   - Sent
   - Outbox
   - Drafts
2. Draft persistence for:
   - compose
   - reply
   - forward
3. Rich thread handling:
   - quoted reply context
   - attachments
   - threading
   - mailbox ownership rules
4. Shared support mailboxes and personal inboxes must remain distinct, just as in web.

### Exit Criteria
- mobile email flows match the `v2` mailbox model, not a reduced notification-only mail view

## Workstream F: Mobile WhatsApp and Channel Operations
### Required Outcomes
1. Full WhatsApp thread handling.
2. Template sending and recovery flows where entitled.
3. Status visibility:
   - pending
   - sent
   - delivered
   - failed
4. Cross-channel context continuity inside ticket/customer views.
5. Linked-case and merge-aware operator context from mobile.

### Exit Criteria
- WhatsApp is not a second-class channel on mobile

## Workstream G: AI On Mobile
### Required Modes
Same as `v2`:
1. no AI
2. `6esk` managed AI
3. BYO AI provider

### Required Mobile AI Capabilities
- AI drafts
- AI summaries
- AI action review
- AI escalations
- QA outputs
- AI policy visibility where relevant

### Product Rule
AI behavior must remain explainable on mobile. Do not reduce AI visibility into a magic button. Users need to see:
- what the AI did
- why it did it
- what is waiting for approval
- what failed

### Exit Criteria
- mobile users can supervise and use AI with the same real authority they have in `v2`

## Workstream H: Analytics, QA, and Decision Support
### Required Capabilities
All `v2` analytics capability must be available on mobile, redesigned for decision speed.

This includes:
- queue health
- response/resolution performance
- SLA performance
- channel volume
- operator performance
- merge review health
- voice QA flags
- transcript-derived insights
- executive-level rollups

### Design Rule
The mobile top surface should optimize for:
- team leads
- managers
- product leaders
- executives

The focus is:
- what needs attention now
- what is improving or worsening
- what action should be taken next

### Exit Criteria
- mobile analytics supports action, not just passive viewing

## Workstream I: Mobile Admin, Security, and Tenant Control
### Required Capabilities
All `v2` admin capability must be represented on mobile:
- user/role management
- tenant/workspace settings
- entitlement controls
- AI/provider controls
- operational recovery
- audit visibility
- security settings
- billing/usage visibility

### Security Requirements
- MFA support
- secure token/session storage
- device/session revoke visibility
- biometric unlock where appropriate
- sensitive-action re-auth where appropriate
- jailbreak/root risk posture defined
- screenshot/privacy posture for sensitive screens where justified

### Exit Criteria
- mobile admin is safe enough to use, not merely convenient

## Workstream J: Offline, Sync, and Reliability
### Goal
Mobile must feel reliable in real-world network conditions.

### Required Capabilities
1. Read caching for recent queues, threads, and customer state.
2. Action outbox for network-loss recovery.
3. Draft persistence independent of network state.
4. Retry and conflict handling.
5. Clear sync-state UI:
   - synced
   - pending
   - failed
   - needs refresh

### Product Rule
Offline support must not create silent divergence from the server truth. The user should always understand whether they are looking at:
- fresh server state
- cached state
- pending local action

### Exit Criteria
- common operator workflows survive intermittent mobile connectivity

## Workstream K: App Store Readiness
### Required Deliverables
- App Store listing package
- Play Store listing package
- privacy disclosures
- permissions model
- store-safe support/contact flows
- release channels:
  - internal
  - beta/testflight
  - production
- crash/error telemetry
- device compatibility matrix

### Operational Requirements
- staged release and rollback strategy
- store review handling process
- incident response for broken releases
- release notes and customer communication process

### Exit Criteria
- mobile app can ship and be operated as a real store-distributed product

## Workstream L: Commercial and Tenant Parity
### Rule
Because `v3` must have all `v2` capabilities, mobile must honor the same:
- tenant isolation
- billing logic
- entitlement enforcement
- AI mode logic
- provider mode logic
- managed-email vs connected-email behavior

### What Cannot Happen
- web-only entitlements
- mobile-only shortcuts that bypass audit/policy
- inconsistent AI modes across clients
- tenant settings that behave differently on mobile and web without explicit design reason

### Exit Criteria
- the same tenant/package can be operated consistently across web and mobile

## Recommended Execution Order
### Phase 0: lock v2 first
- do not ship `v3` before `v2` is operationally stable

### Phase 1: mobile platform foundation
- auth/session
- API/view-model contracts
- push/deep-link framework
- sync model

### Phase 2: operator core
- support
- inbox
- WhatsApp
- calls
- tickets
- drafts/outbox/live desk

### Phase 3: AI + analytics + QA
- AI workflows
- transcript/QA surfacing
- action-oriented analytics

### Phase 4: admin + security + billing visibility
- full mobile admin parity
- tenant and entitlement controls
- secure high-risk actions

### Phase 5: store readiness and release operations
- app-store packaging
- beta rollout
- production rollout

## v3 Definition Of Done
`6esk v3` is done when it is a true native mobile version of `v2`, with:
- all `v2` capabilities
- native mobile UX rather than web shrink-wrap
- live desk behavior for operators
- mobile-safe admin and security controls
- action-oriented analytics for managers/executives
- reliable push, sync, drafts, and queue behavior
- store-distributed production readiness
