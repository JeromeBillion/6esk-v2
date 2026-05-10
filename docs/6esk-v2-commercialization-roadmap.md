# 6esk v2 Commercialization Roadmap (Multi-Tenant SaaS)

## Purpose
`6esk v2` is the independence and go-to-market version of the product: a true multi-tenant B2B SaaS platform, no longer a custom internal CRM for `6ex`.

This roadmap starts only after `v1` is fully working.

Roadmap relationship:
- predecessor: `6esk v1` is treated as locked legacy scope; this file is the current canonical v2 roadmap
- mobile follow-on: [6esk v3 Mobile Roadmap](./6esk-v3-mobile-roadmap.md)

Handover note:
- no standalone Claude/Codex handover document exists in this worktree by filename or content search
- this roadmap, the dirty diff, and the test suite are the source of truth for unpushed production-readiness work

## Product Thesis
`6esk v2` sells the operating model currently implied by the landing page:
- every serious support channel in one surface
- optional AI automation across text and voice
- human operators can step in without losing context
- modular commercial packaging
- enterprise-grade trust, telemetry, and controls

## Security-First Commercialization Principle
Security is the top priority for `v2`. This is not a polish workstream after the SaaS shape exists; it is the constraint that decides whether the product is allowed to hold external customer data at all.

`6esk v2` is market-ready only when it is safe to run as a hostile-internet, multi-tenant system where:
- one tenant can never read, mutate, export, infer, or influence another tenant's data
- every external ingress path fails closed in production
- all provider secrets, OAuth tokens, webhook secrets, AI keys, and hosted-email credentials are tenant-scoped and rotatable
- internal support access is just-in-time, least-privilege, time-bounded, and fully audited
- AI output is treated as untrusted derived data, never as verified truth
- security telemetry, audit trails, backup/restore proof, incident response, and tenant deletion/export controls are launch gates, not later improvements

The commercial test is simple: if we cannot explain and prove tenant isolation, access control, auditability, incident response, and data lifecycle controls to a serious buyer, `v2` is not ready to sell.

## Baseline Assumptions
- architecture: true multi-tenant SaaS
- `v2` can run with no Venus dependency
- a forked AI orchestration module will originate from Venus, but be packaged as a 6esk module
- customers may choose:
  - no AI
  - 6esk-managed AI orchestration
  - bring-your-own AI API/provider
- landing page and public GTM site are `v2` scope, not `v1` scope
- internal business operations for the SaaS must have their own platform/workspace (`6esk Work`)
- security is a `P0` launch gate, not one roadmap lane competing with feature work
- tenant isolation must be mechanically enforced and regression-tested, not left to handler discipline
- provider ingress for webhooks, email, voice, WhatsApp, webchat, and AI callbacks must fail closed in production when secrets or signature configuration are missing
- all external AI/STT/providers are treated as subprocessors and untrusted network dependencies

## Commercial Packaging Model
### Core Platform (included)
These should not be priced as standalone add-ons:
- support workspace shell
- analytics
- admin
- operations tooling
- human-to-6esk vanilla webchat

### Billable Modules
- email workspace connectivity
- managed email service
- WhatsApp
- voice
- AI automation
- AI orchestration service module (forked from Venus)
- bring-your-own AI provider mode
- implementation / professional services (business-side offering)

### Email Module Modes
The email offer must be modular, because `6esk v2` should be able to replace the need for a separate workspace/email-tool subscription for some customers, while integrating cleanly with existing providers for others.

Supported modes:
1. Connected email workspace
   - connect Google Workspace, Microsoft 365, or another supported provider
   - use OAuth/API/IMAP-SMTP integration where appropriate
   - 6esk operates the support workflow while the customer keeps its existing mailbox provider
2. Managed 6esk email service
   - 6esk provisions and operates the support email layer for the customer's domain
   - 6esk can offer mailboxes, aliases, routing, and support inboxes without the customer buying a separate workspace tool just to run support

Commercial rule:
- some customers will buy only the CRM + connect their own provider
- some customers will buy the full managed stack, including email service
- both modes must be tenant-safe and interchangeable without product rewrites

### AI Commercial Rule
If a customer uses our managed AI stack:
- they pay the AI module price inclusive of our orchestration/runtime margin and token cost model

If a customer brings their own AI API/provider:
- token cost is removed from our pricing model
- we still charge for our orchestration/runtime layer and support margin

## v2 Success Criteria
`6esk v2` is ready for market only when all of the following are true:
1. Security launch gates pass before external tenant data is onboarded.
2. Tenants are isolated safely in a true multi-tenant architecture.
3. Customers can be provisioned, billed, configured, and supported as external companies.
4. Every billable module can be turned on/off per tenant without code forks.
5. AI can be disabled, 6esk-managed, or BYO-provider.
6. Email can run in either connected-provider mode or 6esk-managed service mode.
7. Security posture is strong enough for real procurement and enterprise review.
8. South Africa legal/compliance requirements are met and international readiness is planned.
9. `6esk Work` exists as the internal backoffice for running the SaaS business.

## v2 Security Launch Gates
These gates must pass before external beta, and again before general availability.

### Gate 1: Tenant Isolation
- every customer-owned table, queue payload, object-storage key, audit event, search/read model, and analytics aggregate carries a tenant boundary
- all application queries either derive tenant scope from trusted request context or execute through tenant-guarded repository/service APIs
- cross-tenant access tests exist for user-facing APIs, admin APIs, background workers, exports, analytics, object storage, and support tooling
- no background job can process a tenant resource without a tenant-scoped job envelope and idempotency key
- backup, restore, export, and delete flows preserve tenant boundaries

### Gate 2: Identity And Authorization
- all sensitive access is deny-by-default and resource-scoped
- role checks are centralized enough to audit and test
- tenant admins, tenant operators, internal support, finance users, implementation partners, and break-glass users have distinct roles
- MFA is required for internal privileged users and tenant admin roles
- sessions can be listed, revoked, expired by policy, and invalidated after credential reset
- support impersonation is explicit, time-boxed, reason-coded, and visible in audit logs

### Gate 3: Secrets, Providers, And External Ingress
- tenant secrets use a managed secret store or encrypted envelope model with rotation support
- OAuth refresh tokens, webhook secrets, AI provider keys, email-provider tokens, telephony credentials, and hosted-email credentials are scoped per tenant and module
- webhooks and callbacks reject unsigned or misconfigured production traffic
- artifact fetches enforce provider allowlists, timeouts, size limits, content-type validation, and malware/abuse controls where relevant
- outbound delivery has idempotency or duplicate-suppression behavior per provider

### Gate 4: Audit, Telemetry, And Incident Response
- security-relevant events are immutable or append-only and tenant-aware
- every sensitive action has actor, tenant, target resource, reason, request ID, source IP/device context where appropriate, and outcome
- alerts exist for auth anomalies, privilege changes, failed webhook validation spikes, provider-token failures, suspicious sending patterns, queue backlogs, and cross-tenant guard violations
- incident runbooks exist for credential compromise, tenant data exposure, provider outage, hosted-email abuse, AI data leakage, and backup/restore failure
- breach-response ownership, customer notification workflow, and evidence collection are rehearsed

### Gate 5: Data Lifecycle And Compliance
- retention rules are configurable by tenant/module where the product promise requires it
- export, deletion, anonymization, legal hold, and suspension flows are tested
- call recordings, transcripts, AI-derived artifacts, email bodies, attachments, provider tokens, audit logs, and billing records have explicit retention owners
- subprocessor, cross-border transfer, DPA/operator agreement, and customer-facing trust artifacts are ready before launch

## Workstream A: Multi-Tenant Core Architecture
### Required Platform Shifts
1. Introduce first-class `tenant`, `organization`, and `workspace` boundaries.
2. Enforce data isolation in every API, worker, integration, and analytics path.
3. Make all connectors tenant-aware:
   - email
   - managed email service
   - WhatsApp
   - voice
   - webchat
   - AI orchestration
4. Add tenant-safe secret storage and rotation.
5. Add tenant lifecycle operations:
   - provision
   - suspend
   - downgrade
   - close
   - export
   - delete/anonymize

### Required Technical Controls
- row-level or service-layer tenant isolation
- request-scoped tenant context that cannot be supplied by untrusted client input
- tenant guards at repository/service boundaries, not only in route handlers
- per-tenant encryption/key strategy where justified
- tenant-safe background jobs and queues
- tenant-safe analytics/read models that can be rebuilt without crossing boundaries
- object-storage keys partitioned by tenant and module
- tenant-aware audit logs
- environment promotion model that does not leak tenant data
- automated cross-tenant regression tests for API, worker, export, and analytics paths

### State Ownership Requirements
- `tenant` owns commercial, legal, security, and billing boundary.
- `organization` owns customer-company identity and contract relationship.
- `workspace` owns operational configuration, users, queues, channels, and module settings.
- channel records, tickets, customers, transcripts, AI artifacts, files, audit events, billing usage, and provider credentials must all be reachable from a tenant boundary.
- derived data is rebuildable; source-of-truth business records and audit events are not.
- no shared cache, queue, object bucket prefix, analytics table, or admin view may omit tenant scoping.

### Migration Requirement
The move from `v1` internal/custom data to `v2` tenant data needs explicit tooling:
- classify legacy records by tenant/workspace
- backfill tenant boundaries with dry-run reports
- detect ambiguous ownership before writes
- prove no orphaned tenantless production records remain
- keep rollback and read-only migration modes available until the cutover is verified

## Workstream B: Authentication, Identity, and Access
### Must-Haves
- OAuth / OpenID Connect support
- SSO readiness for enterprise customers
- MFA for admin and sensitive roles
- SCIM or later-directory-sync roadmap for enterprise lifecycle management
- stronger role and permission model beyond current internal assumptions
- session policies, device/session visibility, and revoke controls
- password reset and credential reset revoke active sessions for the affected identity
- tenant-level security policy controls for MFA, session lifetime, allowed domains, and SSO enforcement
- audit visibility for login, logout, failed login, MFA challenge, session revoke, role change, and support impersonation

### Commercial Requirement
Auth can no longer assume a single internal company operating model. Identity must support:
- multiple companies
- multiple workspaces
- external admins
- external operators
- partner/professional-services access where needed

### Authorization Model
- authorization is tenant-scoped, resource-scoped, and deny-by-default
- module entitlements are not a substitute for permissions; a tenant may own a module while a specific user remains unauthorized
- internal 6esk staff roles are separate from tenant roles
- support access uses time-bounded grants with reason capture and tenant-visible audit where appropriate
- break-glass access requires MFA, explicit approval path, alerting, and post-event review
- service-to-service calls use scoped service identities, not shared all-powerful internal tokens

## Workstream C: Feature Entitlements, Packaging, and Metering
### Goal
Commercial packaging must be enforced by system design, not sales promises.

### Required Capabilities
1. Entitlement engine for channels and AI modules.
2. Metering for:
   - connected email volume
   - managed email mailboxes / aliases / seats / sending volume
   - WhatsApp volume/templates
   - voice usage
   - AI text actions
   - AI voice actions
   - orchestration runtime consumption
3. Plan/catalog model:
   - core plan
   - add-on modules
   - usage-based metrics
4. Downgrade/upgrade behavior with safe transitions.
5. Tenant-facing visibility into enabled modules and usage.

### Admin Usage and Billing Visibility
Customers and internal operators need a usage page in Admin before paid rollout.

Required page capabilities:
- current-month estimated bill, split by base modules, add-ons, usage charges, credits, and VAT where applicable
- module-level usage counters for email, WhatsApp, voice, AI automation, Dexter orchestration, and webchat
- usage-over-time charts by day/week/month with filters for module, channel, actor type, provider mode, and workspace
- drill-down from invoice line item to the source usage events that explain the charge
- clear separation between human-only, AI-assisted, fully autonomous AI, managed-provider, and BYO-provider usage
- budget guardrails, usage warnings, and unusual-spend indicators by tenant/module
- exportable usage CSV/PDF that is tenant-scoped and reconciliation-safe
- role-gated access so customers can view their own usage while only authorized internal roles can see cross-tenant finance views

### Revenue-Supporting Requirement
The system must distinguish:
- human-only channel usage
- AI-assisted usage
- fully autonomous AI usage
- BYO-provider AI usage

### Security Requirement
- entitlement checks happen before provider calls, queue writes, AI execution, and outbound delivery
- entitlement changes are audited and reversible
- downgrade/suspend states stop new usage safely without destroying customer records
- billing/metering data is append-only or reconciliation-safe enough to defend invoices
- failed entitlement checks are visible in support diagnostics without exposing other tenant data

### Email Service Commercial Requirement
The platform must support two distinct email commercial models:
1. Bring-your-own email workspace
   - connect an existing Google Workspace, Microsoft 365, or equivalent provider
   - ingest/send mail without forcing mailbox migration
2. 6esk-managed email service
   - provision email support capability directly for the customer's domain
   - reduce or eliminate the customer's need for a separate workspace-style support mail tool

This means packaging, entitlement, metering, onboarding, and support flows must all understand the difference between:
- connected provider mail
- managed 6esk mail

## Workstream D: Email Service Productization
This is a separate workstream because once 6esk offers hosted/managed email, we are no longer only integrating with email systems. We are partially becoming one.

### Product Requirement
Customers must be able to choose between:
1. Connected-provider email
2. Managed 6esk email service

### Connected-Provider Requirements
- OAuth and provider integration for Google Workspace and Microsoft 365 first
- mailbox import/sync model
- shared inbox routing and send-as behavior
- provider token lifecycle and refresh handling
- failure visibility when provider auth or sync breaks
- least-privilege provider scopes with documented customer-facing consent language
- token revocation, rotation, and re-consent flows
- tenant-safe sync checkpoints and replay behavior

#### OAuth Implementation Architecture (Approved Plan)
1. **Sync Frequency**: The sync engine will run via a cron job every **60 seconds** to poll for new mail from all connected providers.
2. **Shared vs. Personal Mailboxes**:
   - **Shared/Support Space (Domain)**: Mails bound for organizational emails (e.g., `support@acme.com`) become tickets visible to everyone in the tenant. Admins will configure these domain mailboxes.
   - **Personal Inbox (Assignee)**: Mails bound for an individual agent's unique account (e.g., `alice@acme.com`) stay in their private inbox, inaccessible to others.
3. **Historical Backfill**: We will **start fresh**. No historical emails will be imported upon connecting an OAuth provider; only new mail going forward will be synced.
4. **IMAP/SMTP Support**: Included in **Phase 1** alongside Google and Microsoft, ensuring self-hosted and alternative business email users aren't blocked at launch.
5. **Encryption at Rest**: Refresh tokens are encrypted using AES-256-GCM.
6. **Provider Routing**: Outbound sending natively falls back to Resend if an OAuth provider is not attached to the sending mailbox.

**Development Phases**:
- **Phase 1**: Base `oauth_connections` schema, Crypto AES-GCM layer, API routes (Auth/Callback), Google + Microsoft + IMAP providers, Provider routing in outbox/replies, and the 60s Sync Engine.
- **Phase 2**: Push notifications (Google Pub/Sub / Microsoft Webhooks) for real-time delivery, OAuth connection health dashboard, Zoho Mail support.
- **Phase 3 (Enterprise)**: Admin-consent flows for M365 org-wide delegation, Google domain-wide delegation, and DKIM/SPF verifications.

### Managed Email Service Requirements
- customer domain onboarding flow
- DNS verification flow
- SPF / DKIM / DMARC setup and validation
- mailbox and alias provisioning
- Cloudflare Email Routing sync from `6esk`
- when an admin creates a user or mailbox in `6esk`, `6esk` also creates or updates the corresponding Cloudflare custom address rule automatically
- outbound delivery infrastructure or provider partnership
- inbound routing into 6esk
- bounce, complaint, suppression, and deliverability handling
- mailbox ownership, suspend, delete, and export lifecycle
- inbound attachment scanning and content safety controls where the provider path does not already provide them
- rate limits, outbound abuse controls, and tenant/domain sending limits
- tenant-scoped suppression lists and complaint handling
- domain ownership re-verification when risky account changes occur

### Business And Ops Implications
If 6esk offers managed email service, we also need:
- deliverability monitoring
- sender reputation management
- abuse/spam controls
- domain warm-up and sending policy controls
- support process for DNS and domain onboarding issues
- clear customer responsibility split for domain ownership and DNS changes

### Commercial Requirement
Managed email service must meter and bill differently from connected-provider email.
The roadmap must support:
- mailbox/seat pricing
- alias/domain pricing if needed
- sending-volume pricing if needed
- onboarding/service fees where justified

### Exit Criteria
- a customer can either connect existing mail or buy managed mail from 6esk
- both modes end in the same operator experience inside the product
- both modes are observable, billable, and supportable
- both modes are secure enough to survive token compromise, spoofed inbound traffic, spam abuse, and tenant suspension

## Workstream E: AI Productization
### Product Requirement
The current Venus-derived capability must become an optional `6esk` module, not a hidden internal dependency.

### Modes To Support
1. No AI.
2. `6esk` managed AI orchestration.
3. BYO AI provider/API.
4. Optional future partner-hosted AI modes.

### Required Architecture
- provider abstraction layer
- cost/margin model by provider mode
- prompt/policy/runtime controls owned by 6esk
- event/audit trail for every AI action
- escalation semantics that preserve full context
- tenant-level AI policy controls
- tenant-level data-use controls for model providers, retention, logging, and training settings
- prompt/template versioning with rollout, rollback, and audit history
- output classification that separates raw source data, model-derived suggestions, and operator-approved actions
- STT abstraction owned by `6esk`, but the `v2` product target is explicitly AI STT rather than legacy telephony-provider transcription
- `v2` STT must include proprietary built-in speaker diarization owned by the `6esk` platform layer
- `v2` STT must include proprietary built-in utterance segmentation owned by the `6esk` platform layer
- provider adapters may still exist underneath, but diarization and utterance semantics must be normalized and controlled by `6esk`, not delegated blindly to whichever vendor is active

### AI Security Requirements
- LLM output is never trusted as authorization, identity, billing, or compliance truth
- prompt injection and tool-call abuse are treated as expected attacks
- AI tools execute through the same tenant, entitlement, and permission gates as human actions
- autonomous actions need explicit tenant policy, bounded tool permissions, idempotency keys, and audit trails
- BYO AI keys are tenant secrets and must never be visible to other tenants or broad internal roles
- provider responses, embeddings, transcripts, summaries, and QA flags must not cross tenant boundaries in caches, traces, prompts, eval datasets, or analytics
- human review is mandatory for high-impact or irreversible workflows until the product has proven controls and customer-approved policy

### AI Production Readiness Sequence
This work must proceed in small, reversible slices. The AI module cannot be treated as "done" just because the Venus-derived code exists in the repo.

Completed production-readiness slices:
- transcript AI jobs now require a tenant boundary before provider execution
- tenant AI provider resolution fails closed for unknown tenants, disabled AI mode, missing BYO keys, and undecryptable BYO keys
- AI usage metering records the resolved provider mode rather than inferring it from incomplete state
- transcript AI worker dispatch carries the job tenant into provider calls and audit events
- agent integration records include tenant ownership so outbox usage can be tied back to a tenant
- production build and focused transcript AI / agent outbox tests pass after the tenant-boundary changes
- tenant-scoped agent events now carry tenant identity from ticket, message, call, reply, merge/link, draft, inbound email, WhatsApp, and portal producers
- agent outbox enqueue, delivery, failed-event listing, retry, and metrics now select integrations within the event tenant rather than a global active integration
- agent event payloads include tenant-safe resource correlation, and tenantless events are rejected instead of silently falling into the default integration
- high-impact merge/link entry points now validate source and target tickets within the caller tenant before executing or publishing agent events
- email replies, WhatsApp sends, approved AI drafts, and outbound bulk email now preserve tenant identity through message, event, audit, and usage writes
- Dexter runtime startup now has an explicit native ElizaOS lifecycle behind `DEXTER_RUNTIME_ENABLED`, deduped startup, disabled/starting/active/degraded/failed states, active agent counts, dispatcher readiness, startup failure reasons, and fail-closed internal event dispatch
- lead admins can read Dexter runtime readiness from `GET /api/admin/agents/runtime` without mutating runtime state
- focused Dexter runtime/admin readiness tests, focused agent/call tests, and the production build pass after the runtime-readiness slice
- agent action execution now binds module entitlement checks to the authenticated integration tenant instead of session/default tenant context, and integrations without tenant ownership fail closed before any AI side effect
- focused agent action safety tests cover missing integration tenant ownership and tenant-scoped module entitlement enforcement
- agent action execution now enforces a per-integration action rate limit from `capabilities.max_actions_per_minute` / `maxActionsPerMinute` or `AGENT_ACTIONS_MAX_PER_MINUTE`, records rate-limit audits, and rejects bursts before ticket side effects
- focused action tests now cover AI module gating, merge/action safety, voice policy/idempotency behavior, and action rate-limit denial before side effects
- non-call agent actions with `idempotencyKey` now claim a tenant-scoped `agent_action_idempotency` ledger before side effects, replay stored responses for duplicate requests, and reject reused keys when the action payload differs
- focused action tests now cover non-call idempotency claim, replay suppression, and conflict behavior before draft side effects
- high-risk agent actions now fail closed without an `idempotencyKey` before executable side effects such as customer contact, approved voice calls, ticket mutation, human-review writeback, merge proposals, direct ticket merges/links, and customer merges
- focused action tests now cover required idempotency for auto-send replies, approved voice calls, ticket priority mutation, and direct ticket merge execution
- agent action execution now supports explicit `dry_run`, `draft_only`, `limited_auto`, and `auto` rollout modes from agent policy/capabilities, blocking before ticket mutation, customer contact, provider calls, or direct merge execution when the mode does not allow the action
- focused action tests now cover dry-run no-side-effect behavior, draft-only mutation blocking, limited-auto customer-contact blocking, and explicit limited-auto allowlisting
- lead admins can read and update tenant-scoped Dexter rollout controls from `GET/PATCH /api/admin/agents/[agentId]/rollout`, with canonical `actionRolloutMode`, `allowedAutoActions`, and `maxActionsPerMinute` persistence plus audit logging
- focused admin rollout tests now cover tenant-scoped lookup, secret-free read responses, invalid rollout rejection, stale alias stripping, canonical policy/capability writes, and audit emission
- agent customer-merge actions and customer-merge review proposals now validate source and target customer IDs inside the authenticated tenant before merge/review side effects
- focused cross-tenant action tests now cover primary ticket lookup, merge target lookup, and customer merge ID validation so unscoped lookups cannot silently use foreign tenant records
- primary agent-action tenant lookup regression coverage now spans draft replies, tag mutation, priority mutation, assignment, human-review requests, and voice call initiation before any action-specific side effects can run
- customer profile, identity, history, bulk-email recipient resolution, inbound-call ticket reopen, and ticket-customer attachment paths now require tenant-scoped service/API contracts instead of optional tenant filters
- focused customer service/API tests now assert tenant predicates for direct customer reads, identity reads, customer history SQL, customer attachment, ticket reopen, customer-history API, customer-profile update API, and bulk-email recipient resolution
- WhatsApp outbox operations now preserve tenant boundaries for admin metrics, failed-event listing, retry, and manual delivery while retaining all-tenant worker execution for shared-secret jobs
- focused WhatsApp outbox tests now assert tenant predicates for failed-event listing, retry SQL, metrics SQL, and admin route calls into tenant-scoped outbox services
- message detail, message mutation, spam marking, attachment fetch, WhatsApp resend, email send, and mailbox draft paths now thread authenticated tenant context through message, attachment, ticket-assignment, mailbox-access, status-event, resend-event, and draft persistence calls
- focused message-service/API tests now assert tenant predicates for message reads, message attachments, ticket assignment checks, mailbox membership checks, thread updates, WhatsApp resend queueing, email send persistence, and draft save/delete routing
- inbound email now derives tenant ownership from the resolved mailbox and writes duplicate checks, customer resolution, tickets, ticket events, messages, attachments, storage cleanup, and agent events inside that tenant
- inbound WhatsApp now derives tenant ownership from the active account/recipient, scopes duplicate checks, ticket/message/status/attachment/storage writes, scopes outbound account selection by tenant, and avoids raw/status persistence when webhook tenant ownership cannot be resolved
- focused inbound tenant-isolation tests now assert tenant predicates for inbound email and WhatsApp store paths; the full Vitest suite and production build pass after this ingress slice
- `/api/health` now reports non-secret Dexter runtime readiness alongside database health, marking enabled-but-inactive runtime states as degraded without exposing startup failure details on the public health surface
- focused health tests cover disabled, degraded, and database-down health responses
- voice call option, outbound queue, and agent voice-action paths now pass authenticated tenant scope into the call service instead of relying on ticket IDs alone
- inbound voice calls now accept trusted tenant scope, validate explicit ticket IDs inside that tenant before attaching messages, write voice messages under the resolved tenant, and require `CALLS_TENANT_ID` for unscoped production ingress instead of silently falling into the default tenant
- call recording/transcript attachments and transcript job enqueue/completion now carry the call session tenant, and transcript job failure audits include tenant context
- focused call-service, recording-storage, outbound-call, inbound-call, Twilio voice webhook, and agent voice-action tests pass after the voice tenant-readiness slice
- OAuth connected-mail sync, outbound sends, and ticket replies now decrypt the actual combined encrypted token payload from `access_token_enc`, refresh back into the same storage shape, and have regression coverage for the sync path
- OAuth mailbox connection writes now use a pinned transaction client for mailbox changes and set provider push subscriptions after commit so external network calls do not hold the transaction open
- the mailbox sync cron fails closed in production when `CRON_SECRET` is absent, and Microsoft webhook validation no longer accepts a static fallback client state
- customer-contact module gates now pass explicit tenant scope for email, WhatsApp, voice, ticket creation, replies, draft sends, and AI action execution instead of relying on default tenant context
- AI call review writebacks now have a tenant-scoped migration and tenant-bound idempotency checks so duplicated AI call summaries cannot cross tenant boundaries

Remaining launch gates:
1. Bounded AI tool execution:
   - every tool/action must pass tenant, entitlement, role/policy, rate-limit, and idempotency checks before side effects
   - autonomous actions must support dry-run, draft-only, human-review, and auto-send modes
   - LLM output must never directly authorize customer contact, billing, identity, compliance, or destructive operations
   - remaining work: broaden cross-tenant regression tests across the remaining action classes and services
2. Observability and operations:
   - queue depth, provider latency, provider errors, model/token usage, spend, denied actions, retries, and hard failures must be visible by tenant/module
   - alerts must exist for AI provider failure spikes, BYO key failures, abnormal tenant spend, action denials, and runtime health degradation
   - support diagnostics must show why AI did or did not act without exposing prompts or cross-tenant data
   - remaining work: promote runtime/outbox/provider signals into tenant-aware dashboards, alerts, and operational runbooks
3. Rollout and rollback:
   - per-tenant AI mode toggles must support `none`, managed, BYO, dry-run, draft-only, and limited auto-action rollout
   - rollback must stop new AI work safely while preserving historical transcripts, summaries, usage, and audit trails
   - failed or disabled AI must degrade to human workflow, not block ticket handling

Outstanding tally after the May 2026 consolidation pass:
- AI module launch blockers: 3 remaining P0 gates: bounded tool execution, observability/operations, and rollout/rollback. Bounded execution is substantially closed for the current action route, customer-service paths, WhatsApp outbox operator paths, message/attachment/resend/draft paths, inbound email/WhatsApp store paths, voice call write paths, OAuth mail provider sends/sync, and call-review writebacks, but still needs broader cross-tenant regression coverage for remaining admin, worker, analytics, export, and support-tool paths before external tenants.
- Wider `v2` security blockers: tenant-guarded repository/service APIs, cross-tenant regression coverage, tenant-safe secrets and rotation, remaining fail-closed provider ingress, support impersonation controls, export/delete lifecycle, and backup/restore proof.
- Commercial blockers: admin usage/billing page with charts and invoice drill-down, tenant-facing module controls, production pricing reconciliation, and internal `6esk Work` backoffice.

### Explicit Commercial Rule
BYO AI should reduce customer cost materially, but 6esk still owns:
- orchestration
- policy enforcement
- safety rails
- routing/runtime layer
- auditability

### Voice / Transcript Product Rule
- call recordings and transcripts remain `6esk` artifacts, not provider-owned artifacts
- telephony transport and transcription transport must be swappable independently
- transcript generation is mandatory for voice-enabled tenants
- `v2` must use AI STT as the canonical transcription path
- diarization and utterance segmentation are mandatory platform capabilities, not optional add-ons
- `6esk` must expose a consistent transcript structure to downstream QA, summarization, and analytics regardless of which STT vendor is active
- transcript-derived AI layers are separate from STT and should be modeled explicitly:
  - summary
  - resolution note
  - QA flags
  - action items
- QA flags are a first-class commercial product capability for voice-enabled AI tenants and should remain explainable against the underlying raw transcript

## Workstream F: South Africa Compliance Baseline
This section covers what we should plan for based on South Africa requirements and what serious B2B customers will expect.

### Minimum South Africa Compliance Baseline
1. POPIA compliance program.
2. Information Officer registration and operating process.
3. PAIA private-body obligations and reporting/manual requirements.
4. Security compromise notification process.
5. Cross-border transfer posture for customer data and subprocessors.
6. Contractual and policy treatment for call recordings, transcripts, and monitoring.
7. VAT and invoicing treatment for SaaS/electronic services.

### What This Means In Practice
#### POPIA
We need:
- lawful processing basis inventory
- operator agreements / DPA equivalents
- retention and deletion rules
- access-control and security safeguards
- breach response and notification workflow
- data subject rights handling
- direct-marketing and consent rules where relevant

#### PAIA
We need:
- private-body PAIA manual/process ownership
- request handling process
- annual/reporting obligations as applicable

#### Voice / Recording
We need a counsel-approved position for:
- recording consent language
- transcript retention
- monitoring/interception boundaries
- region-specific differences where customers operate outside South Africa

#### VAT / Finance
We need:
- SaaS billing model validated for South Africa
- VAT treatment and invoicing flow
- finance controls for recurring subscriptions and usage billing

#### Email Service / Domain Operations
We need a compliant and supportable position for:
- customer-domain verification and control
- mailbox retention and deletion
- cross-border handling where email data or providers sit outside South Africa
- outbound sender reputation and complaint handling
- terms governing hosted email service vs connected-provider integration

### Enterprise Readiness Beyond Legal Minimum
South Africa legal minimum is not enough for SaaS growth. We should also plan for:
- SOC 2 readiness
- ISO 27001 readiness
- vendor security questionnaire workflow
- trust center / subprocessor list / penetration testing evidence

## Workstream G: Security Program
This is the highest-priority `v2` workstream. It owns the launch gates for external customer data and should be staffed before feature commercialization work accelerates.

### Threat Model To Own Explicitly
The security program must assume and test for:
1. cross-tenant data exposure through API bugs, background jobs, analytics, exports, object storage, caches, or support tooling
2. compromised tenant admin account
3. compromised internal support or break-glass account
4. stolen OAuth refresh token, webhook secret, AI provider key, telephony credential, or hosted-email credential
5. forged webhook/callback traffic
6. malicious inbound email attachment or customer-supplied file
7. hosted-email spam/abuse or domain reputation attack
8. AI prompt injection, tool-call misuse, data exfiltration, or unsafe autonomous action
9. entitlement bypass leading to unauthorized provider spend or customer-contact actions
10. backup/export/delete process leaking or retaining data incorrectly

### Required Platform Security Upgrades
1. secrets management and rotation discipline
2. stronger audit logs and immutable event provenance
3. encryption in transit and at rest review
4. least-privilege access model across services and ops
5. vulnerability management and patch SLAs
6. dependency/SAST/DAST/container scanning
7. backup, restore, and disaster-recovery drills
8. tenant data export and deletion controls
9. abuse prevention / spam / fraud controls
10. admin hardening, break-glass, and privileged-access controls
11. stronger protection around tenant mailboxes, provider tokens, and hosted email domains

### Secure Engineering Baseline
- security requirements included in design review before implementation starts
- threat modeling for every new external integration, privileged admin feature, AI tool, and data export/import path
- typed or structured boundary validation for public APIs, webhooks, and worker payloads
- secure defaults in config: production cannot boot with missing critical secrets for externally reachable modules
- non-production data policy that prevents uncontrolled copies of real tenant data
- dependency, container, and infrastructure scanning with tracked remediation SLAs
- secrets scanning on commits and CI
- structured security tests for authz, tenant isolation, webhook signatures, SSRF/file-ingress controls, and session revocation
- regular restore drills and incident exercises, not only written runbooks

### Privileged Access Rules
- internal access to tenant data is not normal application access; it is privileged support access
- privileged access requires MFA, least privilege, reason code, ticket/reference link, time limit, and audit trail
- break-glass is exceptional, alerting-backed, and reviewed after use
- production database access should be minimized and replaced with audited support tools wherever possible
- provider dashboards and cloud consoles must use SSO, MFA, role separation, and named accounts

### Security Evidence Pack
Before serious commercialization, maintain a buyer-ready evidence pack:
- architecture and tenant-isolation overview
- data flow and subprocessor map
- encryption and secrets-management summary
- access-control and privileged-access policy
- incident response summary
- backup/restore and business-continuity summary
- penetration-test summary and remediation status
- vulnerability management policy
- retention, deletion, export, and legal hold policy
- AI data-use and BYO-provider security model

### Security Definition Of Done For Market Entry
- documented security program
- regular penetration testing
- incident response runbook
- backup restore proven
- tenant isolation verified
- customer-facing security documentation ready
- external-facing modules fail closed when security configuration is missing
- all critical findings from security tests and penetration testing are closed or formally risk-accepted by leadership before launch
- support access, break-glass, provider credentials, and hosted-email operations are audit-ready

## Workstream H: Telemetry, Reliability, and Supportability
The current internal-tool telemetry bar is not enough.

### v2 Must-Haves
- tenant-aware observability
- per-module health and latency dashboards
- AI cost and outcome telemetry
- delivery telemetry for email/WhatsApp/voice
- deliverability telemetry for managed email domains and outbound reputation
- SLOs/SLAs and alerting model
- public status page and incident comms workflow
- support diagnostics that do not require engineering access
- security telemetry for auth anomalies, privilege changes, webhook validation failures, provider-token failures, suspicious sending, AI tool denials, and cross-tenant guard violations
- tenant-scoped correlation IDs across API requests, worker jobs, provider callbacks, outbound sends, transcript jobs, AI jobs, billing events, and audit logs
- queue-depth, retry, dead-letter, idempotency, and duplicate-suppression dashboards for customer-contact paths

### Why This Matters
A SaaS business dies if it cannot:
- explain failures quickly
- meter usage correctly
- prove service quality
- isolate one tenant's issue from another's
- prove whether a customer incident is isolated, contained, and recoverable

## Workstream I: Billing, Finance, and Revenue Operations
### Required Systems
1. pricing catalog and quote model
2. subscriptions and add-on module billing
3. usage-based billing for channels/AI where applicable
4. invoicing, VAT, collections, and dunning
5. plan changes, proration, credits, and refunds
6. finance reconciliation against provider spend
7. margin reporting by tenant/module
8. hosted-email cost and margin tracking separate from connected-email mode
9. tenant-facing Admin usage and billing page with charts, estimated invoice, usage exports, and explainable line items

### Financial Control Requirements
- usage records must be tenant-scoped, append-only or reconciliation-safe, and traceable to source events
- provider spend reconciliation must detect abnormal spikes by tenant/module
- billing suspension must stop new billable usage without corrupting historical records or audit trails
- invoices and usage exports must never include another tenant's usage, identifiers, or metadata
- manual credits, refunds, write-offs, and plan overrides require role checks and audit trails
- customer-facing usage totals must reconcile to the same source events used for invoices
- usage charting must make invoice shock visible before month end through budget warnings and forecasted totals

### Missing From Current Internal-Tool Shape
The platform currently behaves like a product. `v2` must also behave like a business system.

## Workstream J: Customer Lifecycle and BizOps (`6esk Work`)
`6esk Work` is required. This is not optional admin polish.

### Purpose
Run the SaaS business itself:
- tenant onboarding
- implementation tracking
- contract state
- module entitlements
- usage review
- renewals
- incidents
- support escalations
- finance visibility
- AI/provider configuration ownership

### Minimum Internal Backoffice Capabilities
1. account and subscription management
2. entitlement management
3. onboarding and implementation pipeline
4. support and incident coordination
5. finance and collections visibility
6. tenant usage and health overview
7. audit of internal operator actions
8. partner/pro-services workflow management
9. email-domain onboarding and deliverability support workflow

### Security Operations In `6esk Work`
`6esk Work` must also become the controlled operating surface for security-sensitive SaaS operations:
- tenant security profile and risk status
- SSO/MFA/security-policy configuration status
- DPA/subprocessor/legal artifact tracking
- security questionnaire workflow and evidence pack links
- incident case management and customer notification state
- privileged support access request/approval/review
- data export, deletion, legal hold, and restore request workflow
- provider credential rotation and re-consent tracking
- hosted-email domain verification, abuse review, and suspension workflow

## Workstream K: GTM and Public Company Readiness
### Required Non-Code Assets
- pricing page
- legal terms and privacy policy
- DPA / operator agreement pack
- subprocessor list
- trust/security page
- status page
- help center / docs
- onboarding/training materials
- product update/change communication flow

### Required Commercial Processes
- sales-assisted onboarding
- implementation playbooks
- support SLAs
- escalation paths
- renewal process
- customer success/account ownership model
- security review process for prospects before engineering is pulled into bespoke questionnaire work

## Things Most Commonly Forgotten When Turning An Internal Tool Into A Business
These are the gaps teams usually underestimate:
1. tenant isolation and safe migration tooling
2. entitlement and billing enforcement drift
3. data export/offboarding/delete workflows
4. contract/DPA/subprocessor governance
5. support, incident, and status-page process ownership
6. finance reconciliation and margin visibility
7. backup/restore drills under real customer expectations
8. procurement and security questionnaire handling
9. abuse/fraud/spam controls for outbound channels
10. internal backoffice tooling for the SaaS operator team
11. usage metering that customers can trust
12. documentation and training good enough for non-engineers
13. support impersonation and break-glass access becoming invisible superuser paths
14. background jobs, queues, caches, analytics, and exports bypassing tenant checks that APIs enforce
15. AI prompt/tooling paths quietly getting broader permissions than human users
16. provider-token compromise response and customer re-consent workflows
17. delete/export/restore flows that pass happy-path demos but fail under legal or incident pressure

## Production-Readiness Audit Findings (May 2026)

A full backend audit was conducted against the current `v2` codebase. Findings are mapped to the roadmap workstreams and security gates they block.

**Overall risk assessment:** MEDIUM — strong fundamentals (parameterized SQL, Zod validation, rate limiting, 90+ tests), but several issues will cause failures under production load or block security gate sign-off.

Current status after the May 10, 2026 consolidation pass:

| Status | Items |
|---|---|
| Closed in code | C-1 async password hashing, C-2 portal ticket authentication, C-3 escaped ticket search wildcards, C-4 password-reset rate limiting, H-1 DB pool/timeouts, H-2 batched WhatsApp status lookup/update shape, H-3 logged WhatsApp store failures, H-4 ticket list limit, M-1 failing health check returns `503`, M-3 ticket detail/message/event tenant arguments are required |
| Closed or clarified in migrations | M-6 duplicate migration names were replaced with `0015b_*` and `0038b_*`; the remaining missing `0041` number is a numbering gap, not an ordering risk for the current lexicographic migration runner |
| Newly closed in this consolidation | OAuth combined-token decrypt/refresh shape, production cron fail-closed behavior, Microsoft webhook static-client-state fallback, OAuth callback mailbox transaction ownership, explicit tenant-scoped contact module checks, tenant-scoped call review writebacks |
| Still open | M-2 fail-fast env validation, M-4 structured logging rollout, M-5 auth/session type cleanup, D-1 API versioning, D-2 ticket-create route decomposition, D-3 shared error envelope, D-4 ElizaOS alpha dependency risk decision, D-5 dependency vulnerability baseline |

### P0 — Critical (must fix before any external tenant data)

These block **Gate 1 (Tenant Isolation)**, **Gate 2 (Identity/Authorization)**, and **Gate 3 (Secrets/Ingress)**.

| ID | Issue | File | Workstream |
|---|---|---|---|
| C-1 | `scryptSync` blocks the event loop on every login and password reset. Under load this is a denial-of-service vector against the entire application. Must migrate to async `scrypt`. | `src/server/auth/password.ts:L7,L19` | B (Auth) |
| C-2 | `/api/portal/tickets` has **zero authentication**. Any attacker can flood the system with fake tickets, pollute customer records, and trigger agent events. Needs an API key or CAPTCHA gate. | `src/app/api/portal/tickets/route.ts:L35` | G (Security) |
| C-3 | ILIKE search does not escape `%` and `_` wildcards in user input, enabling wildcard injection for data extraction via timing or pattern probing. | `src/server/tickets.ts:L293` | G (Security) |
| C-4 | `/api/auth/password-reset` is not in the rate-limit middleware matcher. Token brute-force is unrestricted. | `middleware.ts:L224-L236` | B (Auth), G (Security) |

### P1 — High (will cause failures at scale)

These block **Gate 4 (Telemetry/Incident Response)** and **Workstream H (Reliability)**.

| ID | Issue | File | Workstream |
|---|---|---|---|
| H-1 | Database pool has no `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, or `statement_timeout`. Default `max:10` will exhaust under production concurrency; runaway queries hold connections forever. | `src/server/db.ts:L7-9` | H (Reliability) |
| H-2 | `applyStatusUpdates` runs 3 sequential queries per WhatsApp status update inside a loop. A single Meta webhook with 20 statuses causes 60+ serial queries. Must batch. | `src/app/api/whatsapp/inbound/route.ts:L258-291` | H (Reliability) |
| H-3 | WhatsApp inbound silently drops messages on `storeInboundWhatsApp` failure — bare `catch { continue }` with no logging. Customer messages can vanish without a trace. | `src/app/api/whatsapp/inbound/route.ts:L336-338` | H (Reliability) |
| H-4 | `listTicketsForUser` has no `LIMIT` or pagination. Tenants with thousands of tickets will trigger OOM and request timeouts. | `src/server/tickets.ts:L383-407` | A (Multi-Tenant) |
| H-5 | 50+ bare `catch {}` blocks across the codebase silently swallow errors. Production debugging will be extremely difficult. Needs at minimum structured logging in every block. | Throughout `src/server/`, `src/app/api/` | H (Telemetry) |

### P2 — Medium (maintainability / reliability gaps)

These block **Workstream H (Supportability)** and weaken **Gate 1 (Tenant Isolation)**.

| ID | Issue | File | Workstream |
|---|---|---|---|
| M-1 | Health check returns `200 OK` even when the database is unreachable. Load balancers and orchestrators will keep routing traffic to broken instances. | `src/app/api/health/route.ts` | H (Reliability) |
| M-2 | Environment variable validation (`env.ts`) is lazy — only runs on first `getEnv()` call. App boots successfully with missing secrets, then crashes on first request. Must fail-fast at startup. | `src/server/env.ts:L29` | G (Security) |
| M-3 | `getTicketById`, `listTicketMessages`, `listTicketEvents` accept `tenantId` as **optional**. Any caller that forgets to pass it queries across all tenants — a cross-tenant data leak vector. Parameter must be required. | `src/server/tickets.ts:L410-479` | A (Tenant Isolation) |
| M-4 | No structured logging. Only scattered `console.log`/`console.error` with no log levels, request IDs, or tenant context. Production log analysis will be impractical. | Codebase-wide | H (Telemetry) |
| M-5 | `session.ts` uses `(row as any)._real_slug` — type-safety hole in the authentication layer. | `src/server/auth/session.ts:L103` | B (Auth) |
| M-6 | Migration numbering collision: two `0015_` files and two `0038_` files. Also missing `0041_`. Order-dependent migration runners may produce unpredictable schema states. | `db/migrations/` | A (Multi-Tenant) |

### P3 — Cleanup (tech debt / scalability blockers)

| ID | Issue | Workstream |
|---|---|---|
| D-1 | No API versioning. Breaking changes to agent webhook, portal, or WhatsApp formats have no buffer. | K (GTM) |
| D-2 | `tickets/create/route.ts` is 822 lines of mixed auth, validation, customer resolution, call policy, message creation, and event dispatch. No separation of concerns. | H (Supportability) |
| D-3 | Inconsistent error response shapes across endpoints (`{ error }` vs `{ error, details }` vs `{ error, code }`). No shared error envelope. | H (Supportability) |
| D-4 | `@elizaos/core@^2.0.0-alpha.77` is an alpha dependency in production, and `next build` still emits bundler warnings for its `import.meta` and dynamic dependency usage through `src/server/dexter-runtime.ts`. Decide whether to pin, isolate, replace, or explicitly accept this runtime risk before launch. | E (AI) |
| D-5 | No `npm audit` baseline or dependency vulnerability tracking. | G (Security) |

### Recommended Fix Sequence

The first audit quick-fix set is now closed in code. The next sequence should focus on remaining launch-gate proof rather than more feature work:

1. **M-2** — make production env validation fail fast at startup, including OAuth, webhook, cron, AI, STT, storage, and provider secrets
2. **M-4** — finish structured logging with tenant ID, request/correlation ID, actor, provider, queue/job ID, and safe error detail
3. **M-5** — remove auth/session type holes and make impersonation/support access contracts explicit
4. **D-5** — add dependency audit baseline and remediation workflow
5. **D-1/D-3** — stabilize public API versioning and shared error envelopes before external integration customers build against the API
6. **D-2** — decompose `tickets/create/route.ts` after the security surfaces are stable, preserving current tests as the safety net

The remaining P1/P2 work should be addressed in Phase 1 alongside security gate evidence, not after commercialization.

## Recommended Execution Order
### Phase 0: lock v1 first
- do not commercialize before `v1` is truly complete

### Phase 1: security and tenant-isolation foundation
- **remaining production-readiness quick-fixes: fail-fast env validation, structured logging, session type cleanup, dependency audit baseline**
- threat model and security launch gates
- multi-tenant model
- tenant-bound data migration strategy
- tenant isolation tests across APIs, workers, analytics, exports, and object storage
- auth/identity/authorization model
- secrets management and provider-ingress fail-closed behavior
- audit event model and privileged-access policy
- remaining production audit P1/P2 items (H-2 through M-6)

### Phase 2: commercial architecture foundation
- entitlements
- tenant-safe connectors
- module-safe queues and provider adapters
- tenant-scoped AI job/provider execution and agent event routing
- tenant lifecycle operations
- support-safe admin tooling

### Phase 3: compliance and trust baseline
- POPIA / PAIA / Info Officer processes
- legal docs
- incident and status posture
- backup/restore proof
- security evidence pack

### Phase 4: packaging and monetization
- billing/metering/catalog
- AI provider modes
- Admin usage and billing page with charts, estimated invoice, and usage exports
- customer-facing plan structure

### Phase 5: bizops operating system
- `6esk Work`
- onboarding, renewals, finance, support ops
- privileged support access and incident workflows

### Phase 6: GTM launch readiness
- public docs
- trust artifacts
- pricing
- implementation and support model
- security questionnaire workflow

## Sources Checked For South Africa Planning
These should be revisited with legal/compliance review before launch, but they are the correct planning inputs to anchor now.
- Information Regulator South Africa home / POPIA / PAIA / Information Officer registration:
  - https://inforegulator.org.za/
- POPIA statutory source:
  - https://www.gov.za/documents/protection-personal-information-act
- SARS VAT overview:
  - https://www.sars.gov.za/types-of-tax/value-added-tax/
- SARS VAT registration guidance:
  - https://www.sars.gov.za/types-of-tax/value-added-tax/register-for-vat/
- SARS electronic services guidance:
  - https://www.sars.gov.za/guide-to-supply-of-electronic-services-by-foreign-suppliers-and-foreign-intermediaries/

## v2 Definition Of Done
`6esk v2` is done when it is no longer merely a strong internal product, but a real company-ready SaaS platform with:
- true multi-tenancy
- commercial packaging
- AI optionality
- security and compliance maturity
- billing and metering
- supportable operations
- a working internal backoffice (`6esk Work`)
- a go-to-market surface that matches what the product can actually deliver
