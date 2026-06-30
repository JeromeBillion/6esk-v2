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
- `v2` has no hidden internal orchestration dependency
- AI orchestration is Dexter-owned and packaged as a 6esk module
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
Commercial pricing is usage/outcome-based, not seat-based. Human users can be added without per-seat billing; the commercial engine charges for the platform, enabled modules, provider pass-through costs, AI outcomes, and retained storage.

Current executable pricing contract:
- Core OS: R699/month
- WhatsApp module: R499/month
- Voice module: R899/month
- Managed AI module: R1,499/month
- BYO AI module: R899/month
- Managed email domain routing: R199/domain/month
- Managed email mailbox: R79/mailbox/month
- Managed email aliases: free
- outbound email delivered: R0.05
- inbound email processed: R0.03
- WhatsApp and voice provider usage: provider cost plus 35% markup
- STT transcript processing: R0.35/minute
- AI outcome/action: R1.00
- storage: R1.00/GB-month

### Core Platform (included)
These should not be priced as standalone add-ons:
- support workspace shell
- analytics
- admin
- operations tooling
- connected email workspace capability
- human-to-6esk vanilla webchat

### Billable Modules
- managed email service
- WhatsApp
- voice
- AI automation
- AI orchestration service module
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
- they pay the Managed AI module price
- they pay R1 per customer-visible AI outcome/action
- managed-provider costs are captured separately and shown as provider cost, not hidden inside a seat model

If a customer brings their own AI API/provider:
- they pay the BYO AI module price
- they pay R1 per customer-visible AI outcome/action
- provider spend is paid directly by the customer to their provider

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

### Current Implementation Status
Multi-tenant core is closed for the current launch-gate scope:
- tenant, organization, workspace, entitlement, audit, channel, ticket, customer, outbox, and billing paths have tenant IDs or tenant-derived context in the implemented services
- tenant lifecycle service now validates provision/suspend/reactivate/close/plan-change operations, preserves lifecycle metadata in tenant settings, audits changes, and treats closed tenants as terminal
- shared module entitlement checks now fail closed unless the tenant is runtime-active, so suspended/closed tenants cannot create new provider/module usage while historical records remain intact
- session-derived tenant context now fails closed when the user has no valid home tenant, and unauthenticated machine ticket creation requires tenant-scoped ingress signing secrets in production instead of defaulting to the legacy tenant
- tag catalogs, ticket-tag joins, ticket-link relationships, mailbox memberships, merge-review tasks, support macros, saved views, password reset state, SLA analytics, overview analytics, voice consent history, voice operator presence, and external profile link cache state now carry tenant ownership and have regression coverage in `npm run test:tenant-isolation`
- CRM customer search, ticket search, analytics volume, tenant-admin audit/security/profile/call-rejection/spam operational reads, and internal backoffice audit reads now have explicit tenant-scope or documented internal-global guard suppression; tenantless admin/user sessions fail closed before database reads
- customer identity and external customer uniqueness is tenant-scoped on migration `0069`, so separate tenants can hold the same email, phone, or upstream customer id without blocking each other
- backoffice tenant APIs expose lifecycle state and controlled plan/status changes for internal staff
- focused regression tests cover lifecycle transitions, backoffice lifecycle control, entitlement denial for inactive tenants, tenant-scoped CRM search, operational analytics/admin reads, and tenant-scoped customer identity conflict targets

Remaining export/anonymize/legal-retention behavior is tracked under the data-lifecycle/compliance tracks, not this core isolation gate. Destructive data-subject deletion is disabled by default and production env validation rejects enabling it until a durable erasure job with object-store retry/evidence exists.

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

### Current Auth Implementation Status
The current v2 recovery branch keeps `users` and `auth_sessions` as the identity/session source of truth. Managed Google/Microsoft login has been implemented as an adapter, not a duplicate auth database:
- `db/migrations/0051_auth_security_foundations.sql` adds tenant security policy, session metadata, and MFA state.
- `db/migrations/0052_privileged_access_grants.sql` adds MFA-gated internal support access grants.
- `db/migrations/0053_auth_oauth_login.sql` adds managed OAuth SSO mode and MFA challenge provider provenance.
- `/api/auth/oauth/authorize` and `/api/auth/oauth/callback` use identity scopes only, map provider email to an existing active v2 user, enforce tenant login-domain policy, and create v2 `auth_sessions`.
- Password and OAuth sign-in both route enrolled privileged users through TOTP MFA before workspace access.
- Session creation, logout, session revocation, password reset revocation, and support impersonation session mutation now include tenant-derived SQL evidence so production tenant-query guard strict mode does not block core auth flows and break-glass session updates cannot be applied by cookie hash alone.
- Tenant admin user/role management now lists only tenant-owned roles, rejects admin sessions without tenant scope, validates role assignment under the current tenant, prevents cross-tenant email/mailbox conflict updates, and creates personal mailboxes through tenant-scoped mailbox ownership and membership rows.
- Admin mailbox, SLA, and spam-rule configuration routes now reject admin sessions without tenant scope; mailbox owner/member joins and membership mutations are tenant-bound, mailbox membership rows carry direct tenant ownership, cross-tenant mailbox address conflicts return 409, and spam-rule create/update/delete writes include tenant predicates.

Remaining auth work is deploy/runtime evidence rather than core code: register provider callback URLs, set `AUTH_OAUTH_LOGIN_ENABLED=true` with Google/Microsoft auth credentials, perform staging OAuth smoke tests, and decide whether a future enterprise OIDC broker/SCIM track is needed.

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
   - managed email domains / mailboxes / aliases / sending volume
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

Current implementation status:
- tenant-scoped billing lifecycle persistence now exists on migration `0054`, covering billing accounts, subscriptions, subscription items, signed adjustments, invoices, invoice lines, and collection/dunning events
- `src/server/billing/lifecycle.ts` derives subscription items from the v2 modular catalog, estimates invoice lines from tenant-scoped usage events, applies pending credits/refunds/write-offs/prorations, computes VAT, creates invoice drafts, transitions invoice lifecycle status, and records collection events
- tenant admins can read lifecycle billing visibility through the workspace billing API; internal staff can sync subscriptions, create audited adjustments, create invoice drafts, transition invoices, and record collection events through the backoffice billing API
- tenant admins can now export customer-safe invoice JSON from persisted `tenant_invoices` / `tenant_invoice_lines` without tenant IDs or raw metadata, with metadata-only audit evidence
- Admin module usage now includes daily chart buckets, tenant-scoped current-estimate linkage to the lifecycle invoice, and customer-safe CSV/JSON usage exports with metadata-only audit evidence
- Admin usage, usage export, and billing routes now fail closed when an admin-looking session lacks tenant scope instead of using the legacy default tenant fallback.
- Module usage metering now also fails closed at the service boundary: missing tenant scope cannot write billable usage under the legacy default tenant, and usage summary reads without tenant scope return an empty summary without querying default-tenant data.
- provider payment collection, real payment-provider reconciliation, invoice PDF rendering, and deployed finance dashboard evidence remain deploy/runtime work

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
- domain routing pricing
- mailbox pricing
- free aliases
- sending-volume pricing
- onboarding/service fees where justified

### Exit Criteria
- a customer can either connect existing mail or buy managed mail from 6esk
- both modes end in the same operator experience inside the product
- both modes are observable, billable, and supportable
- both modes are secure enough to survive token compromise, spoofed inbound traffic, spam abuse, and tenant suspension

## Workstream E: AI Productization
### Product Requirement
Dexter must be an optional `6esk` AI module, not a hidden internal dependency on an adjacent product.

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
- human approval is a rollout-mode behavior, not a universal brake: `hybrid_review` routes configured actions to approval, while `full_auto` executes preauthorized actions without human approval and fails closed or escalates safely when policy, confidence, entitlement, or risk gates do not pass

### AI Autonomy Modes
These names are the target contract for Dexter and the admin UI. Existing aliases such as `auto` or `limited_auto` should be migrated deliberately instead of left ambiguous.

| Mode | Meaning | Human approval behavior |
|---|---|---|
| `dry_run` | Dexter evaluates context, policy, and likely actions without writing drafts or touching customer records. | No approval request because no side effect is allowed. |
| `draft_only` | Dexter may create internal drafts, summaries, classifications, and safe recommendations. | No approval request unless a tenant explicitly asks to review draft publication separately. |
| `hybrid_review` | Dexter prepares action proposals for customer contact, mutation, merge, billing-affecting, export, or other configured actions. | Approval is mandatory before those side effects. |
| `full_auto` | Dexter executes tenant-approved actions autonomously inside configured policy, scopes, spend caps, confidence thresholds, rate limits, idempotency, and kill switches. | No human approval. If an action is not preauthorized or confidence is insufficient, Dexter must deny, defer, or hand off to a human workflow without performing the side effect. |

### AI Production Readiness Sequence
This work must proceed in small, reversible slices. The AI module cannot be treated as "done" until Dexter is tenant-scoped, policy-bound, observable, and locally verified.

Completed production-readiness slices:
- transcript AI jobs now require a tenant boundary before provider execution
- tenant AI provider resolution fails closed for unknown tenants, disabled AI mode, missing BYO keys, and undecryptable BYO keys
- AI usage metering records the resolved provider mode rather than inferring it from incomplete state
- transcript AI worker dispatch carries the job tenant into provider calls and audit events
- agent integration records include tenant ownership so outbox usage can be tied back to a tenant
- production build and focused transcript AI / agent outbox tests pass after the tenant-boundary changes
- tenant-scoped agent events now carry tenant identity from ticket, message, call, reply, merge/link, draft, inbound email, WhatsApp, and portal producers
- public portal/webchat ticket ingress now resolves tenant scope from v2 tenant public-origin allowlists instead of `DEFAULT_TENANT_ID`; production rejects missing, untrusted, or ambiguous public origins before tenant data writes
- agent outbox enqueue, delivery, failed-event listing, retry, and metrics now select integrations within the event tenant rather than a global active integration
- agent event payloads include tenant-safe resource correlation, and tenantless events are rejected instead of silently falling into the default integration
- high-impact merge/link entry points now validate source and target tickets within the caller tenant before executing or publishing agent events
- email replies, WhatsApp sends, approved AI drafts, and outbound bulk email now preserve tenant identity through message, event, audit, and usage writes
- Dexter runtime startup now has an explicit native ElizaOS lifecycle behind `DEXTER_RUNTIME_ENABLED`, deduped startup, disabled/starting/active/degraded/failed states, active agent counts, dispatcher readiness, startup failure reasons, and fail-closed internal event dispatch
- tenant-scoped lead admins can read Dexter runtime readiness and secret-free AI provider gateway readiness from `GET /api/admin/agents/runtime` without mutating runtime state or exposing API keys/base URLs
- focused Dexter runtime/admin readiness tests, focused agent/call tests, and the production build pass after the runtime-readiness slice
- agent action execution now binds module entitlement checks to the authenticated integration tenant instead of session/default tenant context, and integrations without tenant ownership fail closed before any AI side effect
- focused agent action safety tests cover missing integration tenant ownership and tenant-scoped module entitlement enforcement
- agent action execution now enforces a per-integration action rate limit from `capabilities.max_actions_per_minute` / `maxActionsPerMinute` or `AGENT_ACTIONS_MAX_PER_MINUTE`, records rate-limit audits, and rejects bursts before ticket side effects
- focused action tests now cover AI module gating, merge/action safety, voice policy/idempotency behavior, and action rate-limit denial before side effects
- non-call agent actions with `idempotencyKey` now claim a tenant-scoped `agent_action_idempotency` ledger before side effects, replay stored responses for duplicate requests, and reject reused keys when the action payload differs
- focused action tests now cover non-call idempotency claim, replay suppression, and conflict behavior before draft side effects
- high-risk agent actions now fail closed without an `idempotencyKey` before executable side effects such as customer contact, approved voice calls, ticket mutation, human-review writeback, merge proposals, direct ticket merges/links, and customer merges
- focused action tests now cover required idempotency for auto-send replies, approved voice calls, ticket priority mutation, and direct ticket merge execution
- agent action execution now uses the target `dry_run`, `draft_only`, `hybrid_review`, and `full_auto` rollout contract while still reading legacy `limited_auto` and `auto` aliases; `hybrid_review` returns `needs_review` before ticket mutation, customer contact, provider calls, or direct merge execution, while `full_auto` proceeds without hidden approval only after tenant, scope, idempotency, prompt-safety, and business-policy gates pass
- focused action tests now cover dry-run no-side-effect behavior, draft-only mutation blocking, hybrid-review customer-contact review requirements, and full-auto customer-contact execution after safety checks pass
- lead admins can read and update tenant-scoped Dexter rollout controls from `GET/PATCH /api/admin/agents/[agentId]/rollout`, with canonical `actionRolloutMode`, `allowedAutoActions`, and `maxActionsPerMinute` persistence plus audit logging
- focused admin rollout tests now cover tenant-scoped lookup, secret-free read responses, invalid rollout rejection, stale alias stripping, canonical policy/capability writes, and audit emission
- agent customer-merge actions and customer-merge review proposals now validate source and target customer IDs inside the authenticated tenant before merge/review side effects
- focused cross-tenant action tests now cover primary ticket lookup, merge target lookup, and customer merge ID validation so unscoped lookups cannot silently use foreign tenant records
- primary agent-action tenant lookup regression coverage now spans draft replies, tag mutation, priority mutation, assignment, human-review requests, and voice call initiation before any action-specific side effects can run
- customer profile, identity, history, bulk-email recipient resolution, inbound-call ticket reopen, and ticket-customer attachment paths now require tenant-scoped service/API contracts instead of optional tenant filters
- focused customer service/API tests now assert tenant predicates for direct customer reads, identity reads, customer history SQL, customer attachment, ticket reopen, customer-history API, customer-profile update API, and bulk-email recipient resolution
- customer/ticket merge search routes now derive tenant scope from the authenticated session, reject tenantless users before SQL, and scope every customer identity, ticket, and message-channel probe to the same tenant
- WhatsApp admin/config and outbox operations now preserve tenant boundaries for provider account settings, templates, admin metrics, failed-event listing, retry, manual delivery, shared-secret maintenance jobs, and human direct-send queueing; no WhatsApp admin/outbox worker path may infer `DEFAULT_TENANT_ID`
- focused WhatsApp admin/outbox tests now assert missing-tenant rejection, tenant predicates for provider settings, template writes, failed-event listing, delivery locks, retry SQL, metrics SQL, and admin route calls into tenant-scoped outbox services
- message detail, message mutation, spam marking, attachment fetch, WhatsApp resend, email send, and mailbox draft paths now thread authenticated tenant context through message, attachment, ticket-assignment, mailbox-access, status-event, resend-event, and draft persistence calls
- focused message-service/API tests now assert tenant predicates for message reads, message attachments, ticket assignment checks, mailbox membership checks, thread updates, WhatsApp resend queueing, email send persistence, and draft save/delete routing
- inbound email now derives tenant ownership from the resolved mailbox and writes duplicate checks, customer resolution, tickets, ticket events, messages, attachments, storage cleanup, and agent events inside that tenant
- inbound email operational state is now tenant-scoped end to end: event idempotency keys are unique per tenant, failed-event list/retry locks/selects by tenant, alert configs/history/metrics filter by tenant, and machine maintenance routes require explicit tenant scope; production maintenance uses the tenant ingress signing-secret verifier instead of allowing a global secret to select arbitrary tenants
- inbound WhatsApp now derives tenant ownership from the active account/recipient, scopes duplicate checks, ticket/message/status/attachment/storage writes, scopes outbound account selection by tenant, and avoids raw/status persistence when webhook tenant ownership cannot be resolved
- focused inbound tenant-isolation tests now assert tenant predicates for inbound email and WhatsApp store paths; the full Vitest suite and production build pass after this ingress slice
- `/api/health` now reports non-secret Dexter runtime readiness alongside database health, marking enabled-but-inactive runtime states as degraded without exposing startup failure details on the public health surface
- focused health tests cover disabled, degraded, and database-down health responses
- voice call option, outbound queue, and agent voice-action paths now pass authenticated tenant scope into the call service instead of relying on ticket IDs alone
- inbound voice calls now accept trusted tenant scope, validate explicit ticket IDs inside that tenant before attaching messages, write voice messages under the resolved tenant, and require `CALLS_TENANT_ID` for any unscoped ingress instead of silently falling into the default tenant
- call recording/transcript attachments and transcript job enqueue/completion now carry the call session tenant, and transcript job failure audits include tenant context
- focused call-service, recording-storage, outbound-call, inbound-call, Twilio voice webhook, and agent voice-action tests pass after the voice tenant-readiness slice
- OAuth connected-mail sync, outbound sends, and ticket replies now decrypt the actual combined encrypted token payload from `access_token_enc`, refresh back into the same storage shape, and have regression coverage for the sync path
- OAuth mailbox connection writes now use a pinned transaction client for mailbox changes and set provider push subscriptions after commit so external network calls do not hold the transaction open
- the mailbox sync cron fails closed in production when `CRON_SECRET` is absent, and Microsoft webhook validation no longer accepts a static fallback client state
- customer-contact module gates now pass explicit tenant scope for email, WhatsApp, voice, ticket creation, replies, draft sends, and AI action execution instead of relying on default tenant context
- AI call review writebacks now have a tenant-scoped migration and tenant-bound idempotency checks so duplicated AI call summaries cannot cross tenant boundaries
- tenant Knowledge Base foundation now has tenant-scoped schema for folders, documents, versions, chunks, embedding metadata, ingestion jobs, and retrieval events; admin APIs can list the tenant KB, create folders, upload allowed SOP files to tenant-scoped object keys, enqueue ingestion jobs, and record audit logs
- focused Knowledge Base tests cover admin-only access, tenant-scoped service queries, parent-folder ownership checks, foreign-folder upload rejection before object storage, upload transaction registration, unsupported file rejection, and audit emission; the full Vitest suite and production build pass after this slice
- Knowledge Base ingestion now has a durable tenant-scoped worker path for text and Markdown: queued jobs lock with stale-running recovery only inside the requested tenant, extracted text is normalized and stored as a tenant-scoped artifact, chunks are generated with hashes/source locators, document versions move to `indexed`, ingestion metrics are exposed through admin API, and secret/admin triggers fail closed without an explicit tenant scope
- Knowledge Base ingestion security now has v2-native scanner/extractor/quarantine contracts recovered from the v1 work: production env validation requires malware scanner and document extractor URLs, the worker scans every original object before extraction, PDF/DOC/DOCX extraction runs only through the configured bounded extractor service, terminal rejected uploads write tenant-scoped `knowledge_quarantine_events`, optional quarantine blob storage uses tenant-scoped R2 keys, and admin ingestion diagnostics expose readiness plus recent quarantine events without file content
- Knowledge Base document lifecycle now requires explicit tenant-admin publication before indexed chunks can become runtime-eligible: admins can publish the latest indexed version, older indexed/published versions are archived, documents can be archived out of future retrieval, and lifecycle actions are tenant-scoped and audited
- Knowledge Base retrieval now has a tenant-scoped published-chunk search contract: only published document versions in `ai_visible` folders are searched, results return source citations with document/version/chunk IDs, scores, source locators, and snippets, every query writes a `knowledge_retrieval_events` ledger entry, and admins can test retrieval through `POST /api/admin/ai/knowledge/search`
- Knowledge Base prompt-injection guardrails now classify uploaded text before indexing and every persisted chunk as tenant-uploaded untrusted content; high-risk full-document prompt-injection attempts are poisoned and quarantined before chunk creation, remaining chunk metadata flags obvious instruction override, secret exfiltration, approval bypass, cross-tenant access, tool coercion, and citation suppression patterns, retrieval returns citation-level safety diagnostics, writes safety summaries to retrieval events, and allows runtime-style retrieval to exclude high-risk chunks
- central prompt-safety guardrails now classify user-controlled runtime prompts as untrusted input, strip zero-width/control characters, flag instruction override, prompt/canary leakage, secret/token exposure, multilingual overrides, encoded smuggling, RAG poisoning, cross-tenant/customer exfiltration, tool-policy bypass, tool coercion, citation/audit suppression, memory persistence, and role impersonation attempts; runtime-style RAG retrieval denies high-risk prompts before chunk search, downgrades medium-risk prompts to read-only/unsafe-content-filtered behavior, and writes redacted query summaries plus redacted prompt-safety decisions into the retrieval ledger without storing the full normalized prompt
- Dexter runtime adapter isolation now separates status reads from native ElizaOS startup/dispatch: health/admin routes read a lightweight runtime-state module, native runtime startup and internal dispatch live behind a facade, `@elizaos/core` is treated as a Next server external package, and the production build no longer emits ElizaOS `import.meta` or dynamic-dependency bundling warnings
- Dexter durable run ledger foundation now has tenant-paired `agent_runs`, `agent_run_events`, `agent_run_steps`, and `agent_tool_calls` schema, outbox events create queued runs transactionally, delivery writes running/completed/retry/failed timeline events, event sequences lock the run row before numbering, and successful agent delivery is no longer requeued solely because later usage/bookkeeping writes fail
- Dexter control-plane command envelope foundation now validates a versioned protocol for `agent.run.create`, `agent.run.cancel`, `agent.wait`, `agent.tool.requested`, `agent.tool.completed`, `agent.approval.requested`, and `agent.run.completed`; outbox-created runs persist `agent.run.create`, completed deliveries now persist `agent.run.completed`, and native run-ledger helpers can append cancel/wait/tool/approval command envelopes with tenant ID, run ID, actor, idempotency key, source channel, resource references, requested scopes, rollout mode, provider mode, lane key, bounded command data, and protocol version
- Dexter tenant lane reservation now gates outbox execution with a Postgres advisory transaction lock per `tenant_id + lane_key`; a run only transitions to `running` when no sibling run in the same lane is already `running` or `waiting_approval`, lane-busy attempts emit a tenant-bound `agent.wait` command envelope with `lane_busy` metadata, and the outbox worker releases the event back to pending without posting to Dexter or consuming an attempt
- Dexter agent tool policy gate now classifies route actions as review, draft, reversible write, external send, or irreversible write; every action request is evaluated through the central prompt-safety guard after tenant ticket/scope/idempotency checks and before any side effect, and tenant-scoped policy decisions are written to `agent_tool_policy_decisions` with redacted prompt-safety telemetry so `full_auto` denials stay audited as policy decisions instead of hidden approvals
- Dexter action rollout handling now treats `hybrid_review` and `full_auto` as first-class runtime/admin modes: legacy `limited_auto` aliases read as `hybrid_review`, legacy `auto` aliases read as `full_auto`, admin writes persist canonical names, hybrid side-effect attempts return `needs_review` and audit `ai_action_review_required`, and full-auto execution does not create hidden approvals
- Dexter lane operations now expose run queue health through admin outbox metrics, including queued/running/waiting/timed-out/lost/failed run counts, stale-active counts, and top lane depth/wait snapshots; admins can trigger tenant-scoped stale-run recovery that marks stale `running` runs as `timed_out`, stale `waiting_approval` runs as `lost`, requeues eligible outbox work with a fresh run, dead-letters exhausted outbox attempts, and writes recovery audit/ledger events
- Dexter route-level tool execution now populates durable `agent_run_steps` and `agent_tool_calls` when agent actions carry a Dexter `runId`: policy/rollout denials create denied tool-call rows, allowed actions create running tool-call rows before side effects, final action results close rows as completed or failed, and admin outbox metrics expose requested/approved/denied/running/completed/failed/cancelled tool-call counts
- Dexter runtime now receives tenant-safe Knowledge Base context through the agent outbox delivery boundary: after a run reserves its tenant/resource lane, v2 retrieves published tenant snippets with prompt-safety and unsafe-chunk filtering, attaches a bounded `dexter_rag_context.v1` payload that explicitly says tenant SOPs are untrusted context and cannot grant permissions or override policy, records `agent.rag.context_attached` ledger evidence, and degrades to empty/error context without blocking ticket delivery if retrieval is unavailable
- Dexter outbox delivery now evaluates the central prompt-safety guard before Knowledge Base retrieval, customer-context construction, prompt sandboxing, runtime step creation, or native/http dispatch: high-risk queued event content is terminally blocked with redacted `agent.prompt_safety.evaluated` ledger evidence, while medium-risk content is delivered only with a downgraded `draft_only` prompt sandbox and read-only/no-external-action telemetry
- Native Dexter `plugin-6esk` now honors the server-built runtime contract at `/hooks/6esk/events`: reply-eligible events must carry prompt-safety telemetry and a prompt sandbox with trusted system/runtime/customer sections plus untrusted event payload boundaries and a valid run ID, denied/no-tool payloads are rejected, downgraded payloads cannot remain `full_auto`, and auto-send is allowed only when both plugin policy and server sandbox are full-auto safe
- Native Dexter-generated CRM reply, review, and call actions now carry source event ID, source event type, run ID, prompt-sandbox mode, compact runtime prompt-safety telemetry, and deterministic idempotency keys so `/api/agent/v1/actions` can attach route-level tool-policy and tool-call ledger evidence to the originating run instead of creating detached side effects
- Dexter runtime now receives server-built customer privacy context through the same delivery boundary: active ticket/customer/message/mailbox/thread scope is resolved only from tenant-scoped database rows, same-customer history IDs are bounded to the resolved customer, ambiguous/conflicted identity states fail closed for history/profile disclosure, the context is attached to runtime payloads and prompt sandboxes as trusted server context, and `agent.customer_context.attached` ledger evidence stores only state/count summaries
- Native Dexter provider prompts now surface the runtime policy boundary, server customer privacy boundary, and cited tenant Knowledge Base snippets as untrusted/cite-required context; requester PII and same-customer history are minimized unless the server-built customer context explicitly resolves and allows them
- Dexter run replay diagnostics now expose tenant-scoped, prompt-safe evidence for a single run through `GET /api/admin/agents/[agentId]/runs/[runId]/replay`: run metadata, ordered run events, steps, tool calls, tool-policy decisions, and Knowledge Base retrieval events are assembled into complete/partial/blocked replay status with secret/PII redaction
- Dexter run-list diagnostics now expose recent and active run evidence through `GET /api/admin/agents/[agentId]/runs` and the Admin Automation tab: tenant-owned integration lookup happens before run reads, status filters are limited to known run states, limits are bounded, failure summaries are redacted, raw metadata/idempotency payloads are not returned, operators can open replay evidence from the selected agent, and mock/demo mode has matching run/replay fixtures for local UI checks.
- Agent admin controls now fail closed when the lead-admin session lacks tenant scope before reading or mutating agent integrations, runtime/provider diagnostics, outbox metrics, outbox delivery/retry state, rollout controls, run-list diagnostics, run replay evidence, run cancellation, or stale-run recovery.
- Admin Dexter run cancellation is now tenant-scoped and evidence-bearing: active `created`/`queued`/`running`/`waiting_approval` runs can be cancelled through `POST /api/admin/agents/[agentId]/runs/[runId]/cancel`, terminal runs are rejected, active tool calls/steps are cancelled, pending/processing outbox work is stopped, and audit plus `agent.run.cancel` command-envelope evidence is written for operator review.
- Dexter prompt-sandbox and output-validation foundations are now recovered in v2-native form: `buildAgentPromptSandbox` separates system constraints, tenant policy, server runtime context, customer privacy context, untrusted event payloads, and untrusted retrieved knowledge; `validateAgentOutput` blocks unsafe generated customer-facing draft/reply output before side effects, enforces server-derived customer/source boundaries for draft/send replies, blocks profile PII overexposure and cross-customer scope expansion, writes tenant-scoped audit evidence, redacts prompt-safety telemetry, and records denied run-tool evidence when a run id is present
- Dexter prompt-template versioning is now recovered in v2-native form: tenant-owned `agent_prompt_templates` and `agent_prompt_template_events` store active/draft/retired sandbox overlays, Admin can list/create/activate/rollback versions through tenant-scoped audited APIs, the Admin Automation tab now exposes prompt-template status with activate/rollback controls and mock/demo fixtures, outbox runtime sandbox construction loads the active tenant template when available, and missing/unavailable template storage falls back to the code template without blocking delivery
- Dexter worker dispatch now writes durable run-step evidence beyond the action route: outbox delivery records a `runtime:deliver_event` step before dispatching to the native/http/external runtime target, marks the step completed or failed with redacted summary metadata, and keeps step-completion bookkeeping best-effort after accepted delivery so local ledger failures do not create duplicate runtime deliveries
- The first fixture-driven AI red-team regression suite is now recovered in v2-native form: prompt safety, full-auto tool policy, generated-output validation, knowledge-ingestion safety, customer-context construction, customer-bound output privacy, outbox prompt/customer-context attachment, and prompt-sandbox trust sections are tested against direct prompt injection, indirect RAG poisoning, tool-policy bypass, secret exposure, cross-tenant/customer exfiltration, cross-customer draft leakage, profile PII overexposure, memory persistence, long-context smuggling, multilingual overrides, hostile provider output, and safe business content; `npm run test:ai-safety` is the local release-gate command for this subset
- The v1 CI gate value is now recovered in v2-native form: pinned GitHub Actions workflows run the AI safety gate and a v2 tenant-isolation regression gate, while `npm run test:tenant-isolation` covers current tenant/auth/provider/billing isolation tests without reintroducing wrong-folder tenant-key scripts
- The production CI gate now runs typecheck, lint, full Vitest, high-severity npm audit, and independent web/backoffice builds on PRs and `main`, with the required branch-protection and rollback stance documented in `docs/ci.md`
- Production env validation now requires `SECURITY_ALERT_WEBHOOK` so privileged-access and security-sensitive alert routing is configured before launch; real alert delivery remains deployment evidence.
- The shared server logger now redacts secret-bearing context keys, nested provider credentials, cookies, authorization headers, webhook signatures, and circular payloads before emitting structured JSON so production diagnostics stay useful without leaking tenant or provider secrets; server/API/Dexter runtime code now routes through that logger instead of direct `console.*`, with a regression test guarding the boundary.
- The first model/provider gateway foundation is now in place for transcript AI and admin diagnostics: tenant AI resolution returns explicit ready/disabled/misconfigured plans, bounded provider timeouts, fallback model metadata, provider-mode cost capture, unsafe provider output is run through the generated-output validator before response/storage, admin runtime diagnostics expose only secret-free provider readiness, and no-AI/invalid-configuration denial reasons do not leak provider secrets
- Resend webhook ingress now consumes the persisted tenant provider-secret foundation in v2-native form: strict mode requires tenant/workspace scope, verifies with the matched tenant-scoped Resend secret, marks the matched secret as used, only allows global `RESEND_WEBHOOK_SECRET` fallback outside strict mode, and rejects scoped payloads whose primary recipient mailbox belongs to another tenant
- Twilio status and recording callbacks now consume the persisted tenant provider-secret foundation in v2-native form: callback tenant scope is resolved from the existing ticket-owned call session, strict mode verifies with tenant-scoped persisted `twilio/auth_token` secrets, matched secrets are marked as used, and global `CALLS_TWILIO_AUTH_TOKEN` fallback is allowed only outside strict mode
- Twilio inbound voice and queue callbacks now consume the persisted tenant provider-secret foundation in v2-native form: provider phone/account ownership is stored in `call_provider_numbers`, strict mode rejects unresolved or ambiguous tenant routes before creating call state, and voice/queue callbacks verify with tenant-scoped persisted `twilio/auth_token` secrets before ringing or mutating operator queue state
- Deepgram/STT now consumes the persisted tenant provider-secret foundation in v2-native form: transcript workers retrieve tenant-scoped `deepgram/callback_token` and `managed_stt/http_secret` secrets, the internal Deepgram bridge verifies tenant-scoped STT HTTP secrets before submitting audio, and transcript callbacks verify tenant-scoped Deepgram callback tokens before attaching transcript content
- Tenant-admin provider-number management is now v2-native: admins can list, create, update, and soft-disable Twilio/provider phone-account ownership records through `/api/admin/calls/provider-numbers`, scoped by `tenant_id` and audited
- Runtime tenant query enforcement is now recovered in v2-native form: `db.query` and clients returned by `db.connect()` inspect tenant-scoped table queries for `tenant_id` evidence, production defaults to strict mode, and env validation rejects disabling it in production; the guard now tracks real v2 launch tables including agent idempotency, agent tool-policy decisions, tenant-owned roles, organizations, knowledge, billing, ingress, provider-secret, and public-ingress tables while rejecting wrong-folder-only aliases that are absent from the v2 migrations

### OpenClaw Review Findings For Dexter CRM Orchestration
Local review source: `C:\Users\choma\Desktop\Claw\openclaw-main`, reviewed as a pattern source only. We are not making OpenClaw a dependency and we are not copying its personal-assistant trust model into `6esk`.

Most valuable OpenClaw patterns reviewed:
- typed gateway protocol and method scopes from `docs/gateway/protocol.md`, `src/gateway/protocol/schema/*`, `src/gateway/method-scopes.ts`, and `src/gateway/operator-scopes.ts`
- agent run lifecycle, `agent.wait`, run events, and terminal snapshots from `docs/concepts/agent-loop.md`, `src/gateway/server-methods/agent.ts`, `src/gateway/server-methods/agent-wait-dedupe.ts`, and `src/infra/agent-events.ts`
- per-session and global lane queueing, dedupe, queue snapshots, stale-lane recovery, and bounded task timeouts from `docs/concepts/queue.md`, `src/process/command-queue.ts`, `src/plugin-sdk/keyed-async-queue.ts`, and `src/auto-reply/reply/queue/*`
- background task ledger, audit, maintenance, lost-task detection, and delivery state from `docs/automation/tasks.md` and `src/tasks/*`
- layered tool policy, owner-only tool filtering, provider/group/session policy merging, and trusted server-derived context checks from `src/agents/pi-tools.policy.ts`, `src/agents/pi-embedded-runner/effective-tool-policy.ts`, and `src/agents/tool-policy-pipeline.ts`
- approval and sandbox blast-radius controls from `docs/tools/exec-approvals.md` and `docs/gateway/sandboxing.md`
- AI threat modeling, security incident process, and release/CI evidence patterns from `docs/security/THREAT-MODEL-ATLAS.md`, `docs/security/incident-response.md`, `SECURITY.md`, and `docs/ci.md`

OpenClaw patterns we must not copy directly:
- OpenClaw explicitly assumes one trusted operator boundary per gateway; `6esk` must assume hostile-internet, multi-tenant SaaS conditions.
- OpenClaw `sessionKey` is routing context, not authorization. Dexter must never use ticket/thread/session keys as tenant authorization.
- OpenClaw in-process queues are useful for shape, but Dexter production queues and run state must be durable in Postgres and/or Redis-backed workers.
- OpenClaw's broad trusted-operator and host-exec defaults are not acceptable for customer CRM actions. Dexter tools must be deny-by-default and tenant-scoped.
- OpenClaw plugin trust assumptions do not transfer. Any Dexter plugin/tool/runtime adapter must be treated as privileged code and reviewed as part of the 6esk trusted computing base.

Target Dexter production model:

```text
tenant/channel/customer event
  -> typed Dexter command envelope
  -> durable agent_runs / agent_run_events / agent_tool_calls
  -> tenant lane queue
  -> policy, autonomy, and approval gate
  -> runtime adapter (ElizaOS or replacement)
  -> bounded tool execution
  -> audit, usage, billing, and operator diagnostics
```

State ownership:
- Postgres is the source of truth for runs, steps, tool calls, approvals, terminal outcomes, usage, and billing references.
- Redis or an equivalent queue may coordinate worker concurrency, but it must not be the only source of truth for business-critical agent state.
- ElizaOS memory/runtime state is not authoritative for CRM, billing, permissions, usage, or audit history.

Feedback ownership:
- every run emits tenant-scoped lifecycle events, tool events, approval events, usage events, and terminal summaries
- every denied action records the policy reason without leaking prompts or cross-tenant data
- admin/support diagnostics must show queue depth, active runs, stuck runs, provider failures, model spend, action denials, and retry/replay status by tenant/module

Blast-radius rule:
- if Dexter, ElizaOS, the model provider, or a tool adapter disappears, CRM ticket handling must degrade to human workflow and preserve queued work for retry/replay
- failed AI must not block human replies, inbound ingestion, customer-contact workflows, billing history, or audit review

#### Dexter CRM Work Items Cherry-Picked From OpenClaw

| ID | Priority | Work item | Required outcome |
|---|---:|---|---|
| E-OC-1 | P0 | Dexter control-plane command envelope | Define versioned Zod/TypeScript schemas for `agent.run.create`, `agent.run.cancel`, `agent.wait`, `agent.tool.requested`, `agent.tool.completed`, `agent.approval.requested`, and `agent.run.completed`. Every command must include `tenantId`, `actorId` or machine actor, `runId`, `idempotencyKey`, source channel, resource references, requested scopes, rollout mode, and provider mode. Untyped runtime payloads are not accepted at the boundary. |
| E-OC-2 | P0 | Durable run ledger | Add durable `agent_runs`, `agent_run_events`, `agent_run_steps`, and `agent_tool_calls` or equivalent tables. Status model must include `created`, `queued`, `running`, `waiting_approval`, `completed`, `failed`, `timed_out`, `cancelled`, and `lost`. Events need monotonic per-run sequence numbers, safe summaries, timestamps, tenant IDs, and resource IDs. |
| E-OC-3 | P0 | Tenant lane queue | Serialize AI work per tenant/resource lane, e.g. `tenant:<id>:ticket:<id>` or `tenant:<id>:channel:<kind>:thread:<id>`, while allowing unrelated tenant/resource lanes to run concurrently. Queue records must support wait time, depth, dedupe, stale running detection, timeout, retry, and dead-letter behavior. |
| E-OC-4 | P0 | Tool scope and policy pipeline | Build a first-class Dexter tool policy pipeline: tenant ownership -> module entitlement -> actor role -> resource permission -> tenant AI mode -> rollout mode -> action allowlist -> rate limit -> idempotency -> tool-specific schema -> autonomy/approval decision. LLM output must never bypass this pipeline. |
| E-OC-5 | P0 | Hybrid approval and full-auto autonomy contract | Model approval as a `hybrid_review` workflow only. Direct customer contact, ticket close, ticket/customer merge execution, voice call initiation, bulk sends, data export, billing-affecting actions, and destructive operations require approval in `hybrid_review`, but must execute without human approval in `full_auto` only when preauthorized by tenant policy, scoped tool permissions, confidence gates, spend caps, idempotency, and kill switches. Approval records must show requester, approver, tenant, resource, proposed diff, expiry, and final outcome. Full-auto denials must be audited as policy decisions, not converted into hidden approvals. |
| E-OC-6 | P0 | ElizaOS runtime adapter isolation | Resolve D-4 by moving `@elizaos/core` behind a runtime adapter/worker boundary so Next request/health/admin routes do not import ElizaOS at module top level. The adapter can be replaced by another runtime without rewriting CRM policy, billing, audit, or queue state. |
| E-OC-7 | P1 | Model/provider gateway and fallback | Add a provider resolver that handles no-AI, managed AI, and BYO AI modes with explicit model selection, fallback candidates, cooldowns, provider timeouts, cost capture, and clear denial reasons for missing/invalid tenant provider configuration. |
| E-OC-8 | P1 | CRM sandbox boundary for tools | Treat AI tools as operating inside a CRM sandbox even when no OS sandbox exists. Tools receive only scoped ticket/customer/message/call data, produce drafts or typed action proposals by default, and cannot access raw provider secrets, unrelated tenant data, exports, or broad admin APIs. |
| E-OC-9 | P1 | Admin run diagnostics and operator controls | Add admin/support surfaces for run timeline, active/stuck runs, queue depth, tool calls, denied actions, approvals, retries, replay, cancellation, runtime health, provider health, and tenant/module usage. These views must be prompt-safe and tenant-scoped. |
| E-OC-10 | P1 | AI security audit and threat model | Create a `6esk` AI/Dexter threat model using OpenClaw's ATLAS-style structure, but rewritten for multi-tenant CRM. Cover direct/indirect prompt injection, tool argument injection, forged runtime events, provider compromise, BYO key leakage, cross-tenant memory bleed, unsafe autonomous action, and billing abuse. |
| E-OC-11 | P1 | Context and memory boundaries | Define session/context visibility rules for email, WhatsApp, voice, webchat, and internal notes. Memory must be tenant/resource scoped, retention-aware, cite source records, and never use global or cross-tenant runtime memory as prompt input. |
| E-OC-12 | P1 | Release and replay evidence | Add golden tests, replay drills, load drills, and CI gates for Dexter flows: duplicate events, tenant mismatch, provider timeout, tool denial, approval expiry, worker crash, runtime restart, stuck run recovery, and billing reconciliation. |

#### Tenant Knowledge Base And SOP RAG Plan
Research sources checked for this plan:
- OpenAI Retrieval / File Search docs: https://platform.openai.com/docs/guides/retrieval
- Google Drive API file download/export docs: https://developers.google.com/workspace/drive/api/guides/manage-downloads
- Atlassian Confluence Cloud REST API page docs: https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/
- NotebookLM Enterprise source upload docs: https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/api-notebooks-sources
- OWASP Top 10 for LLM Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/

Decision: start with a tenant-owned Knowledge Base in Admin, not external connectors. Google Drive, Confluence/Atlassian, and NotebookLM Enterprise import paths are useful later, but the first production-safe version should let tenant admins create folders and upload SOP/business-knowledge files directly. That keeps state, permissions, ingestion, retrieval, billing, and audit under `6esk` control before we add external sync complexity.

Target admin surface:
- route: `Admin -> AI Settings -> Knowledge Base`
- folder tree for SOPs, policies, FAQs, product manuals, escalation guides, compliance notes, and internal playbooks
- upload support for `.pdf`, `.docx`, `.md`, `.txt`, and controlled HTML/CSV only after extraction safety is proven
- document version history, publish/archive state, processing status, extraction errors, last indexed time, uploader, file size, page/section count, and per-folder AI visibility
- drag/drop upload, create folder, move file, rename, archive, replace version, restore version, and delete/export controls
- tenant admin test console: ask a question, see retrieved snippets, source citations, confidence, denied sources, and why Dexter would answer or escalate
- quota and billing visibility for stored files, extracted text, embedding count, retrieval calls, reindex jobs, and model usage

Target flow:

```text
tenant admin upload
  -> object storage under tenant/module/document/version key
  -> malware scan, MIME sniff, size/page limits, checksum
  -> durable ingestion job
  -> text extraction worker
  -> chunking, metadata, versioning, and redaction checks
  -> embeddings and keyword index
  -> published knowledge source
  -> Dexter retrieval with tenant/resource/policy filters
  -> cited answer, draft, proposal, or autonomous action
  -> usage, audit, billing, and retrieval event ledger
```

State ownership:
- Postgres is authoritative for `knowledge_folders`, `knowledge_documents`, `knowledge_document_versions`, `knowledge_chunks`, `knowledge_embeddings` metadata, `knowledge_ingestion_jobs`, `knowledge_quarantine_events`, `knowledge_retrieval_events`, and future `knowledge_connectors`.
- Object storage holds original files and extracted text artifacts under tenant-scoped keys; object storage keys are never treated as authorization.
- The vector index is a rebuildable read model. It must carry tenant ID, document version ID, chunk ID, folder ID, published state, source hash, and retention metadata.
- Only `published` document versions are available to Dexter runtime retrieval. Draft, failed, archived, deleted, or processing versions are excluded.

Feedback ownership:
- ingestion jobs expose queued/running/indexed/failed state, retry count, worker error class, extraction warnings, and last successful index time
- retrieval events record tenant, run ID, document version IDs, chunk IDs, scores, filters, prompt-safe query summary, answer/action correlation, and token/cost usage
- admin diagnostics show stale indexes, failed extraction, missing embeddings, low-confidence retrieval, source conflicts, and quota exhaustion

Blast-radius rule:
- if extraction, embedding, vector search, or a connector fails, Dexter must degrade to normal ticket context and human workflow instead of inventing SOPs
- deleting or archiving a document version removes it from future retrieval but preserves required audit/billing history
- if the vector index is corrupted or unavailable, it must be rebuildable from Postgres/object storage without losing tenant files or audit trails

RAG security rules:
- tenant documents are data, not instructions. Uploaded SOPs can inform answers and actions but cannot grant permissions, override platform policy, alter autonomy mode, disable audit, expose secrets, or authorize cross-tenant access.
- source hierarchy is fixed: platform safety rules -> tenant AI policy -> published tenant KB snippets -> ticket/customer/call context -> inbound customer text.
- every retrieval query is tenant-scoped and optionally folder/module/resource scoped before vector or keyword search runs.
- retrieval uses hybrid search where practical: keyword + vector search, metadata filters, score thresholds, optional reranking, and citation requirements.
- Dexter must cite source documents for SOP-based answers and record source IDs for autonomous actions.
- low-confidence, missing-source, conflicting-source, or stale-source retrieval must trigger safe denial, draft-only response, or human handoff according to autonomy mode.
- prompt injection, poisoned documents, malicious file metadata, and tool-argument injection are expected attacks; ingestion and runtime prompts must isolate untrusted text from executable instructions.
- documents containing secrets, credentials, payment data, or excessive personal data should be rejected, redacted, or marked restricted before indexing.

#### Tenant Knowledge Base / RAG Work Items

| ID | Priority | Work item | Required outcome |
|---|---:|---|---|
| E-RAG-1 | P0 | Admin Knowledge Base UX | Add an AI settings surface where tenant admins can create folders, upload files, inspect processing state, publish/archive versions, and test retrieval with citations. The UX must make failed indexing and quota limits visible without leaking prompts or other tenants' data. |
| E-RAG-2 | P0 | Tenant-scoped data model | Add tenant-scoped folder, document, version, chunk, ingestion-job, embedding-metadata, and retrieval-event tables with indexes for tenant/folder/status/version lookups. Enforce DB constraints so documents and chunks cannot exist without tenant ownership. |
| E-RAG-3 | P0 | Secure upload and storage pipeline | Store originals under tenant-scoped object keys, enforce auth/role/module checks, MIME sniffing, extension allowlist, size/page limits, checksum dedupe, malware scanning hook, encryption-at-rest assumptions, and audit logs for upload/replace/delete/export. |
| E-RAG-4 | P0 | Async extraction and chunking worker | Move PDF/DOCX/Markdown/text extraction out of request handlers into durable jobs with retry, timeout, poison state, extraction warnings, normalized text artifacts, source-page/heading metadata, and deterministic chunk IDs. |
| E-RAG-5 | P0 | Embedding and vector read model | Generate embeddings only from sanitized chunks, store provider/model/version metadata, support rebuilds, and prevent cross-tenant vector queries with tenant filters at the repository/query layer. |
| E-RAG-6 | P0 | Retrieval contract with citations | Build a typed retrieval service that accepts tenant, run/resource context, allowed folders, query purpose, score threshold, and max chunks; returns safe snippets with citation metadata and never raw broad document dumps. |
| E-RAG-7 | P0 | Dexter runtime integration | Inject retrieved SOP snippets into Dexter as bounded context, not policy. `hybrid_review` proposes cited actions for approval; `full_auto` may act without approval only when published sources, tenant policy, confidence, idempotency, and tool scopes all pass. |
| E-RAG-8 | P0 | Prompt-injection and data-poisoning defenses | Add ingestion and runtime guardrails that treat document content, filenames, metadata, and customer text as untrusted. Test malicious SOPs that try to override system policy, leak secrets, widen permissions, or force tool calls. |
| E-RAG-9 | P1 | Admin retrieval debug and support diagnostics | Show admins/support which documents were used, which were excluded by policy/status/folder filter, low-confidence decisions, stale index warnings, and failed ingestion reasons. Keep raw prompts and sensitive chunks out of broad support views. |
| E-RAG-10 | P1 | Usage, billing, quotas, and retention | Meter storage, extracted text, embedding jobs, retrieval calls, reranking, model usage, and reindexing. Add tenant quotas, unusual-spend warnings, retention/export/delete handling, and invoice drill-down linkage to the Admin usage page. |
| E-RAG-11 | P1 | Evaluation and replay suite | Add golden questions per tenant fixture, citation accuracy checks, no-answer tests, stale-source tests, cross-tenant negative tests, prompt-injection tests, worker crash/retry tests, and vector-index rebuild drills. |
| E-RAG-12 | P2 | External source connectors after foundation | Add Google Drive, Confluence/Atlassian, and NotebookLM Enterprise import/sync only after E-RAG-1 through E-RAG-11 are stable. Connectors must preserve tenant OAuth scopes, source ACLs, versioning, deletion sync, audit events, and explicit admin source selection. Consumer NotebookLM should not be treated as a reliable enterprise source connector. |

Current implementation status:
- E-RAG-1 through E-RAG-4 are substantially closed for local launch code with tenant-scoped Admin KB APIs, direct uploads, text/Markdown ingestion, configured PDF/DOC/DOCX extractor handoff, malware-scanner fail-closed gates, quarantine diagnostics, publication/archive lifecycle, tenant object keys, and poison handling for terminal unsafe extraction.
- E-RAG-6 and the first E-RAG-7 runtime attachment are closed for keyword retrieval: Dexter receives bounded cited snippets only after tenant lane reservation, uploaded SOPs are marked as untrusted context rather than policy, retrieval events correlate to run/resource IDs, and failures degrade safely.
- E-RAG-5, deployed scanner/extractor/R2 evidence, stronger E-RAG-8/E-RAG-11 eval/load coverage, deeper Admin diagnostics polish, quotas/billing drill-down, and external connectors remain outstanding or post-launch depending on deployment scope.

Acceptance gates for this tenant Knowledge Base track:
- a tenant admin can upload SOP files, publish them, test retrieval, and see citations before Dexter uses them in production workflows
- a malicious document cannot override platform policy, widen tool scopes, alter autonomy mode, disable audit, expose secrets, or cross tenant boundaries
- `full_auto` actions backed by SOP retrieval are auditable without requiring human approval, and failed gates degrade safely
- retrieval results are explainable by document, version, folder, chunk, score, and run/action correlation
- deleting, archiving, reindexing, or rebuilding documents does not orphan files, chunks, embeddings, audit events, or billing records

Acceptance gates for this OpenClaw-derived Dexter track:
- no Next route imports the native ElizaOS runtime at module top level
- all AI runs and tool calls are recoverable from durable state after process restart
- every tool side effect has a tenant, actor, resource, scope decision, idempotency key, and audit record
- admin users can explain why Dexter acted, did not act, waited, failed, retried, or required approval
- a malicious tenant/customer message cannot widen Dexter's CRM permissions, provider access, or context visibility
- disabling AI for a tenant stops new AI work without corrupting historical runs, usage, audit trails, drafts, transcripts, or human workflows

Remaining launch gates:
1. Bounded AI tool execution:
   - every tool/action must pass tenant, entitlement, role/policy, rate-limit, and idempotency checks before side effects
   - autonomous actions must support `dry_run`, `draft_only`, `hybrid_review`, and `full_auto` modes
   - LLM output must never directly authorize customer contact, billing, identity, compliance, or destructive operations
   - remaining work: close E-OC-1 through E-OC-5 and soak-test the E-OC-6 bridge boundary in staging before external AI automation, then broaden cross-tenant regression tests across the remaining action classes and services
2. Observability and operations:
   - queue depth, provider latency, provider errors, model/token usage, spend, denied actions, retries, and hard failures must be visible by tenant/module
   - alerts must exist for AI provider failure spikes, BYO key failures, abnormal tenant spend, action denials, and runtime health degradation
   - support diagnostics must show why AI did or did not act without exposing prompts or cross-tenant data
   - remaining work: broaden E-OC-7 through E-OC-9 beyond current transcript-AI/runtime/outbox diagnostics, then promote runtime/outbox/provider signals into tenant-aware dashboards, alerts, and operational runbooks
3. Rollout and rollback:
   - per-tenant AI mode toggles must support `none`, managed AI, BYO AI, `dry_run`, `draft_only`, `hybrid_review`, and `full_auto`
   - rollback must stop new AI work safely while preserving historical transcripts, summaries, usage, and audit trails
   - failed or disabled AI must degrade to human workflow, not block ticket handling
   - remaining work: close E-OC-10 through E-OC-12 so rollout decisions have threat-model, memory-boundary, replay, and release evidence

Outstanding tally after the May 2026 consolidation pass:
- AI module launch blockers: 4 remaining P0 gates: bounded tool execution, tenant Knowledge Base/SOP RAG, observability/operations, and rollout/rollback. The OpenClaw review adds a concrete Dexter CRM execution track under E-OC-1 through E-OC-12, and the Knowledge Base plan adds E-RAG-1 through E-RAG-12. Bounded execution is substantially closed for the current action route, customer-service paths, WhatsApp outbox operator paths, message/attachment/resend/draft paths, inbound email/WhatsApp store paths, voice call write paths, OAuth mail provider sends/sync, call-review writebacks, the first Knowledge Base state/API/text-ingestion/publication/cited-retrieval/prompt-injection-diagnostics foundation, scanner/extractor/quarantine contracts, the first central runtime prompt-safety classifier/RAG denial layer, tenant-safe Dexter RAG context attachment, outbox pre-dispatch prompt-safety denial/downgrade gating, native Dexter plugin prompt-sandbox/customer-privacy/RAG boundary enforcement, customer privacy context attachment, the durable run ledger/outbox timeline foundation for Dexter, the typed Dexter control-plane envelope foundation for create/cancel/wait/tool/approval/completion commands, tenant lane reservation plus lane wait/depth/stale diagnostics and stale-run/dead-letter recovery, admin run cancellation, route-level tool-call step ledger population, worker dispatch step ledger population, tenant-safe run-list diagnostics, tenant-safe run replay diagnostics, tenant-scoped runtime/provider diagnostics, v2-native prompt-template versioning/rollback, prompt-sandbox/output-validator foundation, customer-bound output privacy validation, transcript-AI provider output validation, first fixture-driven AI red-team regression suite with a local `test:ai-safety` release gate, first transcript-AI provider gateway foundation, and the first agent tool policy gate for prompt-safety/tool-class denial before side effects. Dexter still needs native runtime tool-call population and policy evidence inside future runtime workers beyond the current route/outbox/native-plugin reply/review/call gates, ElizaOS worker/process isolation beyond the current adapter boundary, deployed scanner/extractor/R2 evidence, embeddings/vector search after launch, provider gateway rollout for future Dexter/model call sites as they are introduced, external load/release evidence, and staging rollout evidence before external AI automation.
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

Current implementation status:
- items 1-5 have a v2-native persistence foundation in code through migration `0054` and `src/server/billing/lifecycle.ts`
- usage billing estimates use the existing tenant-scoped `workspace_module_usage_events` table and `estimateUsageRevenueCent` catalog rules
- manual credits/refunds/write-offs/prorations are signed, tenant-scoped, statused records with audit logs
- invoice drafts persist explainable line items, apply pending adjustments, and prevent duplicate active invoices per tenant/workspace billing period so invoice totals reconcile to the same source estimate
- collection/dunning events are tenant-scoped records that update billing account collection posture
- remaining work for item 6 is provider-spend/payment-provider reconciliation with deployed credentials and external dashboard evidence
- item 9 is locally covered for launch-readiness by daily usage buckets, Admin chart visibility, customer-safe usage CSV/JSON export, and customer-safe invoice JSON export on top of the lifecycle API; invoice PDF rendering remains a later presentation layer unless required for the first deployment

### Financial Control Requirements
- usage records must be tenant-scoped, append-only or reconciliation-safe, and traceable to source events
- provider spend reconciliation must detect abnormal spikes by tenant/module
- billing suspension must stop new billable usage without corrupting historical records or audit trails
- invoices and usage exports must never include another tenant's usage, identifiers, or metadata
- manual credits, refunds, write-offs, and plan overrides require role checks and audit trails
- customer-facing usage totals must reconcile to the same source events used for invoices
- usage charting must make invoice shock visible before month end through budget warnings and forecasted totals

### Backoffice Billing And Finance Cockpit
The `6esk Work` `/billing` tab must become the internal finance control panel that keeps the business alive. It must explain revenue, direct runtime/provider cost, margin, invoice lifecycle, adjustments, collections, reconciliation state, and audit evidence from server-side records.

Source-of-truth rule:
- Postgres billing lifecycle tables and existing server-side billing services remain authoritative for subscriptions, usage, invoice estimates, invoice drafts, invoice lines, adjustments, collections, and audit evidence.
- The UI must not calculate authoritative money client-side. Client-side calculations may only format or visualize values returned by trusted server services.
- Provider-spend and payment-provider reconciliation must stay visibly marked as runtime/deployed-evidence pending until deployed credentials, provider dashboards, and reconciliation exports are verified.

Required cockpit capabilities:
- global P/L summary across tenants: estimated revenue, direct runtime/provider cost, gross profit/loss, margin percentage, open receivables, overdue receivables, pending adjustments, and collection count.
- tenant financial health table showing profitability, billing status, plan/module posture, open invoices, overdue exposure, collection status, dunning status, and missing-evidence flags.
- selected-tenant drill-down for subscription source, enabled modules, current estimated invoice, persisted invoices, invoice lines, pending/applied adjustments, collection events, and recent billing audit events.
- module profitability by module and usage kind, with usage quantity, event count, customer bill estimate, direct cost, gross P/L, margin percentage, provider mode, and source evidence.
- invoice lifecycle visibility for draft, open, paid, void, and uncollectible states, including due dates, paid dates, amount due, source line count, and export/review actions.
- dunning and collections queue showing overdue invoices, failed payment attempts, reminders, escalations, paused collections, write-offs, and required next action.
- audit evidence for every subscription sync, invoice draft, invoice transition, adjustment, collection event, export, and reconciliation note.
- anomaly and reconciliation flags for missing billing email, negative margin, stale metering sync, suspended tenant generating usage, overdue AR, aged pending adjustment, abnormal provider/runtime cost spike, duplicate invoice attempt, and missing provider reconciliation evidence.

Hardening requirements:
- finance mutations require internal-staff authorization plus MFA or a scoped privileged-access grant.
- all billing actions must be tenant-scoped and validated server-side for tenant ownership, route parameters, invoice ownership, date ranges, non-zero amounts, legal status transitions, and reason text.
- high-risk billing actions need idempotency keys: subscription sync, invoice draft creation, adjustment creation, invoice status transition, and collection event recording.
- mutation and audit evidence must commit atomically, or through a durable outbox/idempotency model that cannot leave unaudited billing state changes.
- operator UX must show explicit tenant selection, action summary, confirmation copy for high-risk actions, recoverable errors, and durable result state without relying on page reload as the only feedback.

Acceptance criteria for this cockpit:
- internal staff can immediately see which tenants are profitable, overdue, risky, or missing billing evidence.
- billing actions are tenant-scoped, MFA-gated, idempotent, audited, and recoverable.
- invoice totals reconcile to persisted lifecycle invoice lines and tenant-scoped usage events.
- uncertainty is visible instead of hidden: missing provider reconciliation, stale usage sync, negative margin, overdue AR, and suspicious spend spikes must be shown as flags.
- implementation passes `npm run typecheck`, focused billing/backoffice tests, `npm run build:backoffice`, and `git diff --check`.

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

### Backoffice UI And Service Architecture
`6esk Work` must ship as its own internal UI and deployable service, not as a hidden tab inside the tenant product app.

Target workspace shape:
- `apps/web` is the customer/operator product app.
- `apps/backoffice` is the internal `6esk Work` app for 6esk staff.
- both apps build and deploy independently as separate services.
- `work.6esk.com` is protected by Cloudflare Access email allowlisting before traffic reaches the app.
- Cloudflare Access is ingress control only; app-level internal staff authorization, MFA, privileged-access grants, and audit logs still apply.

Shared logic must be extracted into isolated packages before the backoffice UI grows:
- `packages/database` owns the Postgres client, transaction helpers, tenant-safe query primitives, and shared migration/query access.
- `packages/types` owns shared DTOs, enums, API contracts, Zod schemas, and workflow/billing/module types.
- `packages/auth` owns session parsing, internal staff checks, MFA/privileged-access guard helpers, and Cloudflare Access JWT verification helpers.
- `packages/ui` owns shared shell primitives, brand/theme components, modal/action-feedback patterns, and dense internal UI primitives.

Required `6esk Work` UI modules:
1. overview: tenant posture, ops health, security readiness, finance/margin status, and action queues.
2. tenants: tenant search, provisioning, status, plan, lifecycle controls, module entitlements, drift, usage, and health.
3. billing and finance: subscription sync, credits/adjustments, invoice drafts, invoice transitions, collections/dunning, and margin visibility.
4. security and access: security readiness, risk profile, privileged access, impersonation review, and security artifact tracking.
5. ops and incidents: provider health, incident cases, escalation state, operational notes, and support coordination.
6. BizOps workflows: onboarding, implementation, renewals, contracts/legal, partner/pro-services, deliverability, and security questionnaire work.
7. audit: internal operator actions filtered by tenant, operator, action type, and target resource.

The billing and finance module must implement the Workstream I backoffice cockpit requirements inside `6esk Work`, not as a customer-facing admin shortcut. It is the internal finance operating surface for revenue assurance, P/L visibility, collections posture, billing evidence, and launch-risk review.

Durable workflow data requirements:
- backoffice cases for onboarding, implementation, contract, renewal, incident, security questionnaire, legal artifact, data request, provider rotation, deliverability, and partner-services work.
- case events for status changes, notes, assignments, approvals, and timeline history.
- tenant backoffice profiles for owner, implementation stage, risk tier, renewal date, security status, and internal notes.
- artifact and evidence links for contracts, DPA/subprocessor records, security evidence, provider dashboards, R2 objects, and external documents.

### Backoffice Acceptance Criteria
`6esk Work` is not launch-ready until:
- `apps/web` and `apps/backoffice` build independently.
- tenant admins cannot access `6esk Work`.
- internal staff auth is enforced on every page and API.
- Cloudflare Access enforcement is production-gated and fails closed for `work.6esk.com` and backoffice API access when required headers/config are missing; this is only the 6esk Work/backoffice ingress boundary and must not put tenant/customer app space behind Cloudflare Access.
- sensitive internal 6esk Work actions require an internal staff MFA session or an active privileged-access grant; read-only internal views may remain internal-staff-only.
- all mutating backoffice actions write audit events atomically with the mutation or through a durable outbox/idempotency model.
- workflow cases are tenant-linked, test-covered, and visible in the internal UI.
- the UI follows `docs/frontend-ui-system.md` and does not introduce a second visual language.
- evidence/artifact links are validated as safe `https:` URLs or controlled internal object references, and backoffice routes have route-parameter validation plus rate limiting.
- customer-facing AI reply generation cannot cite, paraphrase, or disclose internal comments; internal notes may only be used for internal staff workflows unless promoted to approved customer-visible facts.

Agreed Gang launch findings to close before push/launch:
- Backoffice control-plane boundary: `/api/backoffice/**` must not be reachable from the customer web app without the same 6esk Work ingress and internal-staff authorization boundary used by `apps/backoffice`.
- Internal staff MFA/privileged grant boundary: finance, security posture, evidence/legal links, impersonation, break-glass support, tenant suspension, and similar high-risk mutations require MFA and/or scoped privileged access.
- Audit integrity: case, tenant-profile, artifact-link, billing/security, and privileged-access mutations must not commit without corresponding audit evidence.
- AI privacy boundary: internal comments are not customer context. They must be structurally separated from customer-visible thread history, not merely hidden by prompt wording or regex output checks.
- Abuse hardening: backoffice endpoints need explicit rate limiting, UUID/parameter validation, and SSRF-safe evidence link validation.
- Regression coverage: tests must prove tenant admins are denied, internal staff without MFA/grant are denied for sensitive mutations, audit failures do not leave unaudited state changes, customer replies cannot use internal comments, and root/customer web routing cannot bypass the backoffice boundary.

Dan review notes:
- State: Postgres remains the source of truth for tenants, billing, auth, workflows, audit, and security posture; Cloudflare Access is ingress control, not business authorization.
- Feedback: `6esk Work` must expose operational status, audit history, security posture, workflow state, and actionable failure states for staff.
- Blast radius: the monorepo migration affects imports, builds, Docker/deploy config, env validation, auth/session boundaries, and app routing, so it must be staged before feature work.

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

## Execution Status Refresh (May 17, 2026)
This status table tracks the 13-item consolidation checklist used in current execution.

| # | Item | Current state |
|---|---|---|
| 1 | v1 lock gate | Deferred by instruction (out of scope for this execution pass) |
| 2 | Security launch gates | Closed in this pass: fail-closed module entitlement context, tenant-scoped admin outbox execution, security readiness API |
| 3 | Multi-tenant core | Closed in this pass: lifecycle transitions, plan-change control, runtime-active entitlement gate, backoffice lifecycle API, and focused regression tests |
| 4 | Auth / identity / access | Closed in this pass: time-bounded break-glass impersonation with mandatory reason/ticket reference and expiry-aware session resolution |
| 5 | Entitlements / packaging / metering | Closed in this pass: entitlement drift detection + repair API and tenant-scoped outbox metering paths |
| 6 | Email productization | Closed in this pass: mailbox delivery mode visibility (`connected` vs `managed`) surfaced via mailbox APIs |
| 7 | AI productization | Closed in this pass for launch-gate scope: production alpha-ack gate for native Dexter runtime (`DEXTER_RUNTIME_ALPHA_ACK`) |
| 8 | SA compliance baseline | Deferred by instruction (tracked, not in current execution scope) |
| 9 | Security program | Closed in this pass: security control-plane readiness snapshot (secrets/toggles/impersonation/outbox-failure posture) |
| 10 | Telemetry / reliability / supportability | Closed in this pass: backoffice ops health snapshot with queue/runtime readiness |
| 11 | Billing / finance / revops | Closed in this pass: tenant margin snapshot service + backoffice finance API |
| 12 | 6esk Work | Closed in this pass: unified backoffice overview API combining tenant/ops/security/finance posture |
| 13 | GTM / public readiness | Pending |

## Recovery Alignment Refresh (June 6, 2026)

This section is the current consolidation truth while the accidental wrong-folder work is being semantically retained in the real v2 repo. Older "closed in this pass" entries remain historical until code is re-verified on the v2 recovery branch.

Current authoritative branch:
- `recovery/v2-retain-all-work` in `C:\Users\choma\Desktop\6esk-v2`
- remote: `https://github.com/JeromeBillion/6esk-v2.git`

Retained and verified in the current recovery branch:
- original v2 baseline and migration sequence through `0049`
- local v2 dirty work preserved from `b717f43`
- white-label external profile cleanup replacing stale adjacent-product coupling
- CRM call E2E downstream observer cleanup using `CRM_CALLS_AGENT_EVENTS_*`
- v2-native tenant ingress/provider webhook secret persistence on migration `0050`, keyed by `tenant_id` and `workspace_key`
- tenant-admin API routes for tenant ingress/provider webhook secret list, rotate, and revoke, with audit logging and one-time plaintext return
- WhatsApp inbound webhook verification now uses tenant-scoped persisted Meta app secrets as a fallback when the global `WHATSAPP_APP_SECRET` does not validate
- Resend inbound webhook verification now uses tenant-scoped persisted Resend webhook secrets in strict mode and rejects scoped payloads that route to another tenant's mailbox
- Twilio status/recording callback verification now uses tenant-scoped persisted Twilio auth-token secrets in strict mode after resolving tenant ownership from the existing call session
- Twilio inbound voice/queue callback verification now uses tenant-owned `call_provider_numbers` records to resolve the tenant before call creation and verifies with tenant-scoped persisted Twilio auth-token secrets before queue/call state changes
- Deepgram/STT callback verification now uses tenant-scoped persisted callback/internal HTTP secrets in strict mode before transcript job dispatch or transcript attachment
- tenant-admin provider-number management now covers Twilio/provider phone-account ownership records, avoiding manual database edits for inbound voice routing configuration
- runtime tenant-query enforcement now exists at the shared Postgres boundary for tenant-scoped tables, with `TENANT_QUERY_GUARD_MODE` validated for production
- v2-native public ingress origin allowlists on migration `0058`, including tenant-admin origin management, production fail-closed origin enforcement, and portal ticket creation scoped to the resolved tenant
- central session/tenant context and `/api/tickets/create` machine ingress now fail closed for missing tenant scope; production machine-created tickets must present a tenant header plus matching tenant ingress signing secret
- production env validation for tenant ingress and provider webhook secret encryption keys
- v2-native auth/session/MFA foundation on migration `0051`, including tenant security policy, session provider/device metadata, revocation evidence, TOTP enrollment/challenge flows, tenant-admin security policy API, user session list/revoke API, password-reset session revocation, and production env validation for MFA secret encryption
- tenant security policy unit coverage now verifies domain normalization, allowlist enforcement, tenant/workspace-scoped reads and upserts, and invalid SSO/OIDC policy rejection
- v2-native privileged-access grants on migration `0052`, including MFA-gated grant request/list/stats APIs, internal-admin approve/revoke/post-event-review actions, impersonation requiring an active tenant-scoped grant, grant expiry capping impersonation duration, grant id recorded on auth sessions, and security readiness counters for active grants/review backlog
- privileged-access request/approve/revoke events now append tenant-scoped security alert outcomes and can notify `SECURITY_ALERT_WEBHOOK` without exposing cross-tenant data
- v2-native Google/Microsoft auth-login adapter on migration `0053`, including identity-only OAuth scopes, CSRF state/nonce cookie, existing-user mapping, tenant login-domain policy enforcement, managed `oauth` SSO mode, audit events without raw email leakage, OAuth+MFA provider provenance, login-page MFA handling, and production env validation when `AUTH_OAUTH_LOGIN_ENABLED=true`
- v2-native billing lifecycle persistence on migration `0054`, including tenant billing accounts, subscription/item persistence from the v2 module catalog, proration adjustments, signed credits/refunds/write-offs, duplicate-safe invoice drafts/lines/status transitions, collection/dunning events, tenant-admin billing visibility, internal backoffice billing actions, and focused regression coverage
- tenant-facing billing/usage APIs reject missing tenant scope before invoice, usage, module, or audit lookups
- module entitlements and module metering now fail closed in production: missing/unreadable workspace module config disables modules instead of enabling all defaults, structured suspended/disabled entitlement states normalize to disabled, missing tenant scope cannot read/write workspace modules or be recorded under the legacy default tenant, tenantless usage-summary reads return empty results, and metering can surface write failures when `MODULE_METERING_FAIL_CLOSED=true`
- metering sync maintenance now runs under explicit tenant scope: shared-secret jobs must send a tenant header, lead-admin sessions use their session tenant, pending-event locks filter by `tenant_id`, and status updates include the same tenant predicate
- agent outbox machine delivery now runs under explicit tenant scope: `/api/agent/v1/outbox/deliver` rejects tenantless shared-secret calls, lead-admin sessions use their session tenant, `deliverPendingAgentEvents` fails closed without a valid tenant UUID, and delivered/failed/lane-release updates include tenant predicates
- agent API machine authentication now requires an explicit tenant header before agent integration lookup; agent integration service reads/writes fail closed without tenant scope, and Dexter CRM plugin startup/API headers now require `SIXESK_TENANT_ID`
- agent draft reads, queue listing, content updates, status transitions, ticket events, and audit logs now require the caller/session tenant and cannot fall back to the legacy default tenant
- Knowledge Base ingestion maintenance now runs under explicit tenant scope: admin metrics/triggers reject tenantless sessions, shared-secret worker triggers must send a tenant header, worker delivery fails closed without `tenantId`, and ingestion job locks filter by `tenant_id`
- ticket detail/update, message detail/update, and attachment download routes now reject tenantless sessions before customer conversation data reads, writes, or blob retrievals
- authenticated CRM action routes now reject tenantless sessions before customer profile/history, spam, WhatsApp resend, bulk email, tags, AI draft, call-option, mailbox, or mailbox-message reads/writes; mailbox message SQL also includes the session tenant predicate after mailbox authorization
- platform mailbox lookup now fails closed without explicit tenant scope instead of reading the legacy default tenant mailbox
- broad ticket list reads now reject tenantless sessions at `/api/tickets`, and `listTicketsForUser` fails closed without a tenant before constructing support queue SQL
- core CRM service writes now reject missing tenant scope before customer resolution, ticket creation, ticket event writes, or outbound email ticket creation; inbound message reference resolution returns no ticket instead of querying the legacy default tenant when tenant scope is absent
- ticket reply sending now rejects missing tenant scope before ticket lookup, uses the supplied tenant for ticket reads, and keeps message body-key updates tenant-scoped after outbound send persistence
- central API rate-limit/request-correlation middleware now backs the existing Upstash dependency: sensitive auth, admin, agent, ticket, email, WhatsApp, and outbound call routes resolve to per-minute profiles; production fails closed when Upstash credentials are absent; production env validation rejects disabled/invalid configured limits; dev/test uses an in-memory limiter; request ids are sanitized and propagated as `x-6esk-request-id`; rate-limit keys prefer Cloudflare connecting IP over spoofable forwarded headers and sanitize/bound tenant, workspace, and client identity parts before limiter lookup
- v2-native release gates recovered from the v1 wrong-folder work: `.github/workflows/ai-safety.yml`, `.github/workflows/tenant-isolation.yml`, `npm run test:ai-safety`, and `npm run test:tenant-isolation`

Still outstanding before v2 main can be considered deploy-ready:
- provider call-site adoption for persisted tenant ingress/provider webhook secrets is now complete for WhatsApp, Resend, Twilio, Deepgram/STT, and unauthenticated machine ticket-create core code paths, including tenant-admin provider-number management; remaining provider evidence is deployment/runtime validation with real credentials and dashboards
- inbound email retry/alert/metrics operational state is now core-code closed for tenant scope; deployment must set `INBOUND_TENANT_ID`, use tenant ingress signing secrets for production maintenance jobs, and run tenant-specific cron/job configuration
- outbound email send/outbox operational state is now core-code closed for tenant scope; enqueue/delivery requires an explicit tenant, admin outbox metrics and maintenance triggers fail closed for tenantless admin sessions, and combined maintenance runners must send `JOBS_RUNNER_TENANT_ID` or `INBOUND_TENANT_ID`
- ticket reply service scope is now core-code closed for tenant scope: direct email/WhatsApp replies cannot fall back to `DEFAULT_TENANT_ID`, and post-send message updates include a tenant predicate
- WhatsApp admin/provider config, template, send/outbox/retry/failed operational state is now core-code closed for tenant scope; direct sends, maintenance delivery, retry, failed-event listing, account settings, and template mutations require explicit tenant scope, and standalone WhatsApp outbox jobs must set `WHATSAPP_OUTBOX_TENANT_ID` or another explicit maintenance tenant header source
- Calls outbox/transcript/transcript-AI operational state is now core-code closed for tenant scope; admin metrics/listing routes reject tenantless sessions, delivery/retry workers require explicit `tenantId`, transcript job locks/retries/listing SQL includes tenant predicates, internal call drains pass the already-resolved tenant, and standalone call maintenance jobs must set `CALLS_OUTBOX_TENANT_ID` or another explicit maintenance tenant header source
- audit logging, bulk ticket mutation, and call dead-letter operations are now core-code closed for tenant scope: tenant audit writes/readbacks require explicit tenant ownership, pre-tenant auth/provider-webhook failures use an explicit platform-audit helper instead of accidental default-tenant fallback, bulk ticket selection/update/events/audit run under the session tenant, and call dead-letter list/recover/quarantine/discard/batch-recover paths filter and audit under the admin session tenant
- support tag catalog/data-model tenantization is now core-code closed: migration `0060` makes `tags` and `ticket_tags` tenant-owned, tag helpers require tenant scope, inbound/portal/agent/bulk/merge tag paths write tenant-pinned rows, support tag CRUD is tenant-filtered, and tag analytics/listing joins include tenant predicates
- merge-review tasks and analytics overview are now core-code closed for tenant scope: migration `0061` makes `merge_review_tasks` tenant-owned, merge-review create/list/detail/resolve paths require session/integration tenant scope, task ticket/customer references are validated inside the tenant, resolution updates include tenant predicates, and analytics overview counters/latency/channel/call/AI/merge aggregates reject tenantless sessions and filter by tenant
- support macros, saved views, password-reset state, and SLA analytics are now core-code closed for tenant scope: migration `0062` makes `macros`, `support_saved_views`, and `password_resets` tenant-owned, support macros/saved-view routes reject tenantless sessions, password-reset creation/consumption carries direct tenant evidence, and SLA analytics reads config/ticket/message compliance only inside the session tenant
- voice consent history is now core-code closed for tenant scope: migration `0063` makes `voice_consent_events` tenant-owned, consent writes require tenant scope and validate customer ownership, latest-consent reads include a tenant predicate, and support/public consent APIs resolve scope through authenticated session or tenant public-ingress policy
- voice operator live presence is now core-code closed for tenant scope: migration `0064` makes `voice_operator_presence` tenant-owned, operator presence reads/writes/reservation/queue outcome updates require tenant scope, Twilio inbound/queue callbacks reserve operators inside the call-session tenant, outbound Twilio desk-target selection uses the outbox tenant, and desk live notifications/roster are tenant-filtered
- external profile link cache state is now core-code closed for tenant scope: migration `0065` makes `external_user_links` tenant-owned, removes the global `(external_system, external_user_id)` uniqueness boundary in favor of `(tenant_id, external_system, external_user_id)`, cache lookup/upsert helpers reject missing tenant scope before database access, and email/WhatsApp/external ticket-create enrichment threads the resolved tenant into live lookup, cache fallback, and cache writes
- ticket linked-case relationship state is now core-code closed for tenant scope: migration `0066` makes `ticket_links` tenant-owned, backfills only when both tickets share a tenant, replaces global pair uniqueness with tenant-scoped pair uniqueness, and link listing/preflight/write paths require caller tenant scope before reading or writing linked-case rows
- mailbox membership authorization state is now core-code closed for tenant scope: migration `0067` makes `mailbox_memberships` tenant-owned, backfills only when mailbox and user tenants match, adds tenant/mailbox and tenant/user referential guards, replaces user-only membership indexing with tenant-scoped indexes, and mailbox list/access/admin/OAuth/user-creation writers require membership tenant evidence before reads or writes
- inbound call ingress fallback is now core-code closed for tenant scope: unscoped calls require `CALLS_TENANT_ID` in every environment, while trusted provider routing and explicit route tenant scope continue to take precedence
- metering sync operational state is now core-code closed for tenant scope; combined maintenance runners must send `JOBS_RUNNER_TENANT_ID` or another explicit maintenance tenant header source, and sync locks/updates only the scoped tenant's pending usage events
- workspace module entitlement state is now core-code closed for tenant scope: tenantless reads return fail-closed disabled modules, tenantless writes reject before database access, and admin module routes return `403` for tenantless sessions
- agent outbox delivery operational state is now core-code closed for tenant scope; machine delivery calls must send `x-6esk-tenant-id` with an accepted maintenance secret, and outbox status updates cannot cross tenant boundaries
- agent API authentication and integration management are now core-code closed for tenant scope; agent API clients and Dexter CRM runtime must send `x-6esk-tenant-id` / `SIXESK_TENANT_ID`, and service lookups no longer fall back to the legacy active agent
- agent draft operational state is now core-code closed for tenant scope: tenantless sessions cannot list, read, update, use, dismiss, or create AI drafts, and draft route side effects write ticket/audit evidence under the session tenant
- Knowledge Base ingestion operational state is now core-code closed for tenant scope; worker jobs can run per tenant through admin session scope or explicit maintenance tenant headers, and deployed scanner/extractor/R2 proof remains deployment evidence
- customer conversation-data route scope is now core-code closed for ticket detail/update, message detail/update, and attachment download: tenantless sessions receive `403` before SQL/object-store access, and the aggregate tenant-isolation gate covers those regressions
- broader authenticated CRM/mailbox route scope is now core-code closed for remaining customer-facing actions: tenantless sessions receive `403` before route side effects, mailbox services fail closed without tenant scope, mailbox membership rows are tenant-owned, and mailbox message listing is tenant-filtered after mailbox authorization
- platform mailbox lookup is now core-code closed for tenant scope: agent integration creation and platform mailbox discovery must provide an explicit tenant before reading mailbox records
- email mailbox creation/resolution is now core-code closed for tenant scope: platform/support mailbox creation requires explicit tenant ownership, personal mailbox creation derives tenant scope from the owner user, cross-tenant mailbox-address collisions cannot update existing mailbox ownership, and inbound support-address routing resolves only an existing mailbox-owned tenant instead of auto-creating under the legacy default tenant
- broad ticket listing is now core-code closed for tenantless sessions: route access returns `403`, the ticket list service returns no rows without tenant scope, and the aggregate tenant-isolation gate includes both route and service regressions
- core customer/ticket write services are now core-code closed for missing tenant scope: no customer resolution, ticket insert, ticket-event insert, or outbound email ticket composition can fall back to the legacy tenant, and inbound reference lookup fails closed to no match without querying default-tenant messages
- CRM search, analytics volume, tenant-admin operational audit/security/profile/call-rejection/spam reads, and internal backoffice audit policy are now core-code closed for the review findings: tenant-admin reads use the session tenant, tenantless sessions fail before DB access, and intentional internal-global audit reads carry an explicit tenant-query-guard suppression comment
- customer identity uniqueness is now core-code closed for SaaS tenant boundaries: migration `0069` replaces global customer/external identity uniqueness with tenant-scoped indexes, and customer resolution/profile/merge code uses tenant-scoped conflict targets and tenant-scoped duplicate checks
- OAuth runtime evidence: provider app callback registration, staging Google/Microsoft smoke tests, and dashboard credential verification are deploy dependencies rather than additional core code
- wrong-folder Better Auth package adoption, tenant offboarding/delete lifecycle, and legacy tenant-key helper scripts are explicitly not launch code: Better Auth is superseded by v2-native sessions/OAuth/MFA, offboarding is deferred post-launch, and tenant-key scripts would conflict with the v2 `tenant_id` architecture
- AI follow-through: native/runtime worker step/tool-call ledger population and policy evidence beyond the current route/outbox/native-plugin reply/review/call gates, deployed scanner/extractor/R2 evidence, post-launch embeddings/vector search, provider-gateway rollout for future Dexter/model call sites, external load/staging rollout evidence, and preserving native Dexter and v2 runtime files; local prompt-injection/customer-bound release coverage now has `npm run test:ai-safety`, and prompt-template activation/rollback is now visible in Admin.
- billing follow-through: customer-safe invoice export and usage chart/export polish are now locally recovered; provider payment/reconciliation wiring, invoice PDF rendering, and deployed finance dashboard evidence remain deployment/runtime work
- tenant export/offboarding/delete workflows remain deferred to post-launch by instruction; query-scope enforcement is now recovered for launch, and the current customer deletion endpoint is disabled by default plus rejected by production env validation until durable erasure jobs ship
- full verification: `npm run typecheck`, `npm run lint`, `npm run test:ai-safety`, `npm run test:tenant-isolation`, `npm test`, `npm run build`, `git diff --check`, stale-coupling scan, migration-sequence check, and roadmap reality check

## Production-Readiness Audit Findings (May 2026)

A full backend audit was conducted against the current `v2` codebase. Findings are mapped to the roadmap workstreams and security gates they block.

**Overall risk assessment:** MEDIUM — strong fundamentals (parameterized SQL, Zod validation, rate limiting, 90+ tests), but several issues will cause failures under production load or block security gate sign-off.

Current status after the May 10, 2026 production-readiness pass:

| Status | Items |
|---|---|
| Closed in code | C-1 async password hashing, C-2 portal ticket authentication, C-3 escaped ticket search wildcards, C-4 password-reset rate limiting, H-1 DB pool/timeouts, H-2 batched WhatsApp status lookup/update shape, H-3 logged WhatsApp store failures, H-4 ticket list limit, M-1 failing health check returns `503`, M-2 production env validation is fail-fast at startup, M-3 ticket detail/message/event tenant arguments are required, M-5 auth/session impersonation row typing is explicit, D-5 dependency audit baseline and high-severity gate are in place |
| Closed or clarified in migrations | M-6 duplicate migration names were replaced with `0015b_*` and `0038b_*`; the remaining missing `0041` number is a numbering gap, not an ordering risk for the current lexicographic migration runner |
| Newly closed in this consolidation | OAuth combined-token decrypt/refresh shape, production cron fail-closed behavior, Microsoft webhook static-client-state fallback, OAuth callback mailbox transaction ownership, explicit tenant-scoped contact module checks, tenant-scoped call review writebacks |
| Newly closed in this execution pass (May 17, 2026) | D-1 integration API version contract, D-2 route-level `tickets/create` decomposition into `src/server/tickets/create-flow.ts`, D-3 shared integration error envelope + contract metadata, M-4 structured logging upgrades for provider webhook, outbox fire-and-forget paths, rollback cleanup, and worker audit failures, E-OC-6 follow-through via `http_bridge` runtime boundary for Dexter |
| Still open in this audit slice | None (v1 lock gate and SA compliance remain explicitly deferred by instruction) |

### Audit Reconciliation (Code-Verified On May 17, 2026)
The original P0/P1/P2 table was preserved as a historical audit artifact, but code has since moved.

Closed and verified in code:
- C-1 async password hashing (`src/server/auth/password.ts`)
- C-2 portal ticket auth gate (`src/app/api/portal/tickets/route.ts`)
- C-3 escaped wildcard search (`src/server/tickets.ts`)
- C-4 password-reset limiter path in middleware (`middleware.ts`)
- H-1 DB pool/timeouts (`src/server/db.ts`)
- H-2 batched WhatsApp status update flow (`src/app/api/whatsapp/inbound/route.ts`)
- H-3 logged inbound-store failure path for WhatsApp (`src/app/api/whatsapp/inbound/route.ts`)
- H-4 bounded ticket listing query limit (`src/server/tickets.ts`)
- M-1 fail-fast health behavior, M-2 production env gate, M-3 required tenant args, M-5 session typing hardening, M-6 migration numbering clarification.

Closed in this execution pass (code-verified):
- **D-1** integration-facing API version contract with `x-6esk-api-version` + request correlation headers (`src/server/api-contract.ts`) wired into ticket, portal, call, WhatsApp, and provider webhook surfaces.
- **D-3** shared API error envelope (`ok/code/error/detail/details/meta`) for integration-facing APIs (`src/server/api-contract.ts`).
- **M-4** structured logging rollout for previously silent fire-and-forget/outbox paths (`src/server/async.ts`), provider webhook rejection/audit flows, rollback cleanup, worker audit failures, and R2 cleanup failures.
- **D-2** `src/app/api/tickets/create/route.ts` decomposed into an orchestration-only route plus channel/business flow module (`src/server/tickets/create-flow.ts`). This closes the route-level launch gate; future channel-by-channel service extraction remains a maintainability follow-up, not a launch blocker.
- **E-OC-6 follow-through** Dexter runtime now supports external runtime boundary mode (`DEXTER_RUNTIME_MODE=http_bridge`) with signed status and event dispatch (`src/server/dexter-runtime.ts`, `src/server/dexter-runtime-state.ts`, `.env.example`, `src/server/env.ts`).

### Recommended Fix Sequence
1. Re-run full integration smoke tests in staging with real provider credentials.
2. Close GTM/public-readiness blockers and commercialization packaging.
3. Execute deferred v1 lock-gate and SA compliance tracks on their own schedules.

## Recommended Execution Order
### Phase 0: lock v1 first
- do not commercialize before `v1` is truly complete

### Phase 1: security and tenant-isolation foundation
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
