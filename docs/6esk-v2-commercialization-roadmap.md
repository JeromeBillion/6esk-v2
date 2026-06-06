# 6esk v2 Commercialization Roadmap (Multi-Tenant SaaS)

## Purpose
`6esk v2` is the independence and go-to-market version of the product: a true multi-tenant B2B SaaS platform, no longer a customer-specific internal CRM.

This roadmap starts only after `v1` is fully working.

Roadmap relationship:
- predecessor: [6esk v1 Completion Roadmap](./6esk-v1-completion-roadmap.md)
- mobile follow-on: [6esk v3 Mobile Roadmap](./6esk-v3-mobile-roadmap.md)

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
- security telemetry, audit trails, incident response, and tenant export/offboarding controls are launch gates; production-only backup/restore/delete execution proof is still required evidence, but is captured during deploy/testing or post-launch lifecycle hardening rather than claimed locally

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

## Roadmap Completion Control Plan
This section is the operating board for finishing `v2`. It exists to prevent scattered "continue" work from creating parallel plans, duplicated docs, or unsequenced implementation.

### Completion Rules
- this roadmap is the single source of truth for `v2` launch readiness
- work proceeds one package at a time, in the order below, unless a newer security finding changes priority
- every package must close with code, docs/runbook updates where relevant, tests, and a named evidence artifact or verification command
- no external tenant data is onboarded until `P0` launch gates are complete, verified, and reviewed
- no new module polish should outrank tenant isolation, auth, AI safety, code-owned lifecycle controls, or incident readiness
- old internal-platform and adjacent-product assumptions must keep being removed or converted into tenant-safe, white-label extension points
- do not mark runtime, production-credential, provider-dashboard, deployed-infrastructure, real-R2, OAuth-smoke, branch-protection, backup/restore, physical-delete, or production evidence tasks complete from local workstation work

### Current Execution Stance: Pre-Deploy Core Code First
Updated: 2026-06-06.

Immediate work is limited to core code that can be implemented and verified locally before deploy/testing. The active deploy-readiness slice is billing lifecycle code: subscription persistence, plan-change/proration behavior, manual credits/refunds, collections/dunning, and full invoice lifecycle. Data lifecycle work is deferred to post-launch unless it is required for code-level product safety. Runtime-dependent evidence stays documented below, but it is not part of the local pre-deploy completion queue.

Immediate pre-deploy code includes:
- tenant isolation code gaps
- auth, session, MFA, and security-policy code gaps
- privileged access and admin authorization code gaps
- Dexter/AI customer-context safety code gaps
- entitlement, billing, usage enforcement, subscription, proration, credits/refunds, collections/dunning, and invoice lifecycle code gaps
- provider routing, webhook, and secret code gaps
- code-owned observability/admin diagnostics gaps
- tests, lint, typecheck, build, static audits, and roadmap cleanup

Deferred to deploy/testing/post-launch evidence, not local code blockers:
- production OAuth/provider smoke evidence
- release session/cache drills
- production provider routing evidence
- tenant ingress signing evidence against deployed URLs
- branch-protection and CI enforcement proof
- external provider dashboard validation
- production object-payload export rehearsal and R2 checks against real data
- production scanner/extractor deployment evidence
- production telemetry evidence
- provider-spend reconciliation against deployed credentials, provider dashboards, and real provider invoices

Deferred to post-launch lifecycle hardening:
- physical tenant delete execution
- production offboarding execution beyond prepared anonymization workflow
- R2 object-destruction rehearsal
- backup/restore drills
- broad retention enforcement beyond the current knowledge-retention foundation
- legal/compliance artifact production and counsel review
- production evidence pack captures that require live tenants, real credentials, or deployed infrastructure

The target handover state is "ready for deploy/testing," not "launch complete," unless every immediate core-code item and every deploy/runtime evidence gate has also been completed and reviewed.

### P0 Completion Queue: Immediate Core-Code Blockers
1. Branch and release baseline
   - reconcile the current dirty branch into one coherent implementation set
   - run and record `npm run typecheck`, `npm run lint`, `npm run build`, full tests, `git diff --check`, and focused tenant/AI safety tests
   - leave no redundant handover/parallel-work docs unless they are linked from this roadmap or `docs/README.md`
2. Tenant isolation proof
   - keep `npm run audit:tenant-query-scope` and `npm run test:tenant-isolation` clean on the final branch state
   - finish or explicitly bound the repository boundary, workspace-level enforcement strategy, or row-level security strategy on top of the runtime tenant query guard so tenant isolation is stronger than static audits alone
   - expand cross-tenant tests across user APIs, admin APIs, workers, queues, object storage, exports, analytics, support tooling, and background jobs
3. Auth and privileged access
   - keep privileged support access, break-glass controls, tenant-admin security policy UI/API, session controls, and central admin guards complete on all sensitive routes
   - close any remaining privileged-role MFA challenge edge coverage and security audit event edge cases
   - ensure future internal-support routes use explicit active-grant enforcement instead of broadening ordinary lead-admin APIs
4. AI/Dexter production safety
   - implement live customer context envelopes with tenant, workspace, channel, active ticket/thread, current customer, allowed history source ids, and ambiguity state
   - allow resolved same-customer CRM history without OTP while blocking other-customer, other-tenant, mailbox-wide, analytics-wide, and hidden runtime scope expansion
   - extend output validators for customer-visible history, profile-PII minimization, source-id enforcement, and ambiguous customer handoff
   - finish local prompt-injection classifier/rule hardening, replay redaction policy, and code-owned canary controls; provider/model eval suites and external worker lifecycle drills move to deploy/testing
5. Data lifecycle code controls
   - keep tenant export payload inclusion, anonymization workflow, legal-hold blocking, retention-preview behavior, and offboarding rehearsal scripts complete and tested locally
   - defer physical delete, production offboarding execution, R2 object-destruction, backup/restore drills, broad retention rollout, and legal artifact production as documented handover/post-launch items
6. Billing, usage, and entitlement integrity
   - finish module entitlements, plan/catalog behavior, downgrade/suspend safety, usage metering, subscription persistence, plan-change/proration behavior, manual credits/refunds, collections/dunning, full invoice lifecycle, VAT posture, customer-safe invoice exports, and usage page/admin visibility
   - ensure entitlement checks occur before provider calls, queue writes, AI execution, outbound sends, and billable usage recording
   - defer provider-spend reconciliation evidence until deployed credentials/provider dashboards/real provider invoices exist
7. Observability, supportability, and incident readiness
   - finish code-owned tenant-aware admin diagnostics, support visibility, dead-letter visibility, queue/retry/idempotency summaries, and security incident evidence collection hooks
   - defer dashboards, alerts, status-page workflow, and deployed telemetry proof to deploy/testing
   - make failures diagnosable without direct engineering/database access

### P1 Completion Queue: Commercialization Foundation
- connected-provider email and managed 6esk email mode must share the same operator experience but remain separately onboarded, metered, secured, and supported
- `6esk Work` must support tenant onboarding, entitlement management, implementation tracking, support/incidents, finance visibility, security artifact tracking, privileged access reviews, and provider credential operations
- public GTM assets must match shipped capability: pricing, trust/security page, status page, legal docs, help docs, implementation playbooks, support SLAs, and security questionnaire process

### Completion Evidence Required
Pre-deploy local evidence:
- release branch test evidence: typecheck, lint, build, full tests, focused tenant tests, focused AI safety tests, static query-scope audit, dependency audit, and diff whitespace check
- AI local evidence: red-team fixture results, prompt/template version coverage, run replay bundle tests, output-validator denial samples, and customer-history source-boundary tests
- tenant local evidence: tenant isolation test suite, tenant export/offboarding tests, tenant offboarding rehearsal script coverage, and static query-scope evidence

Deploy/testing evidence:
- tenant isolation database audit, provider routing rehearsal, tenant ingress signing drill, migration dry-run, apply/rollback bundle review, object-storage access checks, production OAuth/provider smoke, session/cache drills, webhook failure drill, provider secret rotation drill, privileged access review trail, billing reconciliation sample, and production object-payload export rehearsal

Post-launch lifecycle evidence:
- physical tenant delete execution, production offboarding execution, R2 object-destruction rehearsal, backup/restore drill evidence, broad retention enforcement, legal/compliance artifact publication, trust-center/security-pack evidence, and any counsel-reviewed POPIA/PAIA/operator-agreement artifacts

### Current P0.1 Baseline Evidence
Updated: 2026-06-06.

Completed:
- branch inventory captured for the current `codex/merge-v1-roadmaps` dirty implementation set
- `npm audit --audit-level=high` is clean after upgrading Vitest to `4.1.8` and overriding transitive PostCSS to `8.5.15`
- `npm ls postcss vitest vite esbuild` confirms Next, Vite, and Tailwind PostCSS paths resolve to patched PostCSS/Vite/esbuild versions
- `npm run typecheck` passes
- `npm run lint` passes with no warnings or errors
- `npm run build` passes on Next `15.5.19`; the production route manifest includes `/api/admin/workspace/billing`
- `npm run test:tenant-isolation` passes: 80 test files, 284 tests
- `npm run test:ai-safety` passes: typecheck plus 7 AI safety test files, 46 tests
- `npm test` passes: 184 test files, 749 tests
- `npm run audit:tenant-query-scope` passes: report `0fb0d2a4-265c-4d42-a970-6c8af92fbe08`, 274 files, 706 query calls, 573 scoped calls, 0 findings
- `git diff --check` reports no whitespace errors; Windows CRLF normalization warnings remain expected

### Current P0.2 Tenant-Isolation Evidence
Updated: 2026-06-03.

Completed:
- runtime tenant query guard now wraps the shared Postgres pool and clients returned from `db.connect()`, inspects SQL string/query-config calls, and blocks tenant-scoped table access without `tenant_key` evidence in strict mode
- `TENANT_QUERY_GUARD_MODE` is now environment-validated, defaults to strict in production, is set to strict in `.env.example`, and cannot be `off` in production validation
- focused guard regression coverage now verifies strict blocking, warning mode, query-config inspection, SQL comment/string stripping, explicit suppression comments, and production default behavior
- `npm run audit:tenant-query-scope` passes locally with 0 findings after scanning 272 files and 680 query calls, including 550 calls with tenant-scope evidence
- `npm run test:tenant-isolation` passes: 78 test files, 269 tests
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:ai-safety`, `npm test`, `npm audit --audit-level=high`, and `git diff --check` all pass on the current branch state

Still required for pre-deploy code handover:
- keep the final branch green for `npm run audit:tenant-query-scope`, `npm run test:tenant-isolation`, and the full release verification set
- extend, or explicitly risk-bound, mechanical enforcement beyond the runtime `tenant_key` guard with workspace-scoped repository boundaries or database row-level security, especially for analytics, exports, support tooling, background jobs, and object-storage payload retrieval

Deferred to deploy/testing evidence:
- capture production/release-tenant evidence for provider routing rehearsal, tenant-ingress signing drill, tenant backfill dry-run/apply/rollback bundle review, tenant isolation database audit, and object-storage access checks
- the current local environment does not have `DATABASE_URL`, `APP_URL`, `TENANT_INGRESS_TENANT`, `TENANT_INGRESS_WORKSPACE`, `PROVIDER_ROUTING_REHEARSAL_TENANT`, or `PROVIDER_ROUTING_REHEARSAL_WORKSPACE` configured, so those evidence artifacts cannot be honestly captured from this workstation

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

### Gate 6: AI And Agent Safety
- prompt-injection, indirect retrieval-injection, data-poisoning, prompt-leakage, and tool-abuse tests pass before any external tenant uses AI automation
- every AI action runs through a tenant-scoped command envelope, policy decision, run ledger entry, idempotency key, and audit event
- model output cannot grant permissions, change policy mode, access cross-tenant data, bypass entitlements, or execute unvalidated tools
- `hybrid_review` and `full_auto` have different behavior by design: hybrid can create review tasks, while full auto must deny, downgrade, retry safely, or execute within hard policy boundaries
- guard events, tool denials, prompt/template versions, model/provider health, and validator failures are visible in tenant-safe admin diagnostics and security telemetry

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

### Current Tenant-Isolation Implementation Status
Updated: 2026-06-03.

Implemented foundation:
- shared server-side tenant context now normalizes trusted tenant/workspace scope and keeps the legacy `primary` tenant as a compatibility bridge
- session creation and lookup now carry tenant/workspace context, and login resolves users inside a tenant boundary instead of by globally unique email alone
- core tenant/workspace schema coverage now exists for users, sessions, mailboxes, CRM tickets, ticket events, messages, attachments, replies, customers, identities, merges, support configuration, WhatsApp, email outbox events, and call records
- global uniqueness for users, mailboxes, customer identities, and external user links has been replaced with tenant-scoped uniqueness where the product requires duplicate values across tenants
- core CRM services and primary admin/user-facing routes now tenant-scope tickets, customers, customer identities, mailbox lookup, mailbox creation, workspace modules, usage metering, external user links, outbound email replies, WhatsApp sends, and the main customer/ticket APIs
- inbound email storage now tenant-stamps idempotency checks, ticket/customer resolution, messages, attachments, ticket events, external-user links, R2 object keys, and agent events after mailbox resolution
- inbound WhatsApp storage now tenant-stamps conversation matching, active account/media lookup, tickets, customers, messages, attachments, status events, external-user links, R2 object keys, and agent events
- voice call creation/update now tenant-stamps outbound and inbound call messages, call sessions, call events, call outbox events, recording/transcript attachments, transcript jobs, R2 object keys, ticket events, and agent events
- support tags and ticket tag mutations now use tenant-scoped tag uniqueness instead of the original global tag-name constraint
- audit log writes and ticket audit-log reads now carry tenant/workspace scope
- lead-admin tenant data export now produces a tenant/workspace-scoped JSON bundle across core CRM, messaging, channel, AI, billing-usage, audit, and operations tables, with password/provider secrets redacted, an object-storage manifest for R2-backed message/attachment/call/quarantine artifacts, and an audit event that records counts without row payloads
- tenant data export can now optionally include actual R2 object payloads in the export bundle: object payload inclusion is explicit, per-object size bounded, base64 encoded with SHA-256 evidence, and refuses to fetch any object key outside `tenants/{tenantKey}/workspaces/{workspaceKey}/...`; skipped object refs record `unsafe_key`, `exceeds_limit`, or `fetch_failed` evidence instead of silently omitting payloads
- tenant isolation audit reporting now checks missing tenant/workspace scope, orphaned tenant/workspace rows, orphaned parent-owned records, cross-tenant parent references, unscoped voice-consent identity rows, and the legacy `primary` bridge; the lead-admin endpoint records only summary evidence in audit logs
- operator and CI wiring now exists for tenant isolation evidence: `npm run test:tenant-isolation` runs the focused regression suite, `npm run audit:tenant-isolation` runs a direct Postgres catalog/data audit against `DATABASE_URL`, and the Tenant Isolation Gate workflow runs tests on PR/push plus an optional scheduled/manual database audit when `TENANT_ISOLATION_AUDIT_DATABASE_URL` is configured
- tenant backfill dry-run planning now exists: `npm run plan:tenant-backfill -- --target-tenant=<tenant> --target-workspace=<workspace>` reads the live Postgres catalog, classifies every tenant/workspace-scoped table still using the source scope, verifies target roots, and writes a redacted JSON evidence artifact under `.launch-evidence/tenant-backfill/` without database writes
- tenant backfill apply/rollback bundle generation now exists: `npm run bundle:tenant-backfill -- --plan=<plan.json>` validates a ready dry-run report, refuses ambiguous target child scopes, and writes reviewed transactional `apply.sql`, `rollback.sql`, manifest, and operator README files under `.launch-evidence/tenant-backfill-bundles/` without executing database writes
- provider routing rehearsal evidence now exists: `npm run rehearse:provider-routing -- --tenant=<tenant> --workspace=<workspace>` runs a read-only database rehearsal for Resend mailbox routing, WhatsApp WABA/phone routing, Twilio phone/account routing, managed STT/Deepgram callback secrets, public origins, and strict provider-secret mode, writing redacted JSON under `.launch-evidence/provider-routing/`
- static tenant query-scope sweep evidence now exists: `npm run audit:tenant-query-scope` scans API, server, and worker SQL query calls for tenant-scoped tables that lack `tenant_key` evidence, writes read-only JSON under `.launch-evidence/tenant-query-scope/`, and has `docs/tenant-query-scope-sweep-runbook.md` for triage and suppression policy
- first static sweep remediation closed tenant-scope blockers in the customer reconciliation script, CRM calls staging E2E local outbox verification, and the admin audit-log API; the current static sweep candidate count is down to 63 remaining findings for triage/remediation
- agent outbox delivery/retry state transitions now carry tenant/workspace scope on outbox rows, runs, and run events; delivery, failure, retry, and completion mutations are tenant/workspace-scoped, with a migration to backfill runtime ledger scope and a static regression test for the outbox SQL surface; the current static sweep candidate count is down to 54 remaining findings
- voice operator presence and live call routing now carry tenant/workspace scope: presence rows are backfilled and indexed by scope, authenticated presence/client-token reads use the caller scope, Twilio inbound/queue reservations and queue-outcome updates use the resolved call tenant, and outbound Twilio desk targets inherit the outbox event scope; the current static sweep candidate count is down to 48 remaining findings
- voice consent lookup and write paths now carry tenant/workspace scope: consent rows are backfilled and indexed by scope, customer/identity consent matching is scoped, public/trusted support-consent ingress resolves tenant scope before writes, and manual/AI call-policy checks read only scoped consent state; the current static sweep candidate count is down to 43 remaining findings
- agent runtime ledger and replay evidence now carry tenant/workspace scope end-to-end: action callbacks must pass scope into run-step/tool-call/completion writes, child ledger rows are inserted only through a matching scoped `agent_runs` row, replay reads filter run events, steps, tool calls, guard events, policy decisions, and prompt templates under the same scope, and recent-run admin diagnostics include workspace scope; the current static sweep candidate count is down to 36 remaining findings
- AI call-review writebacks now carry tenant/workspace scope: legacy rows are backfilled from `call_sessions`, new request-human-review writebacks insert scoped rows after proving the call session belongs to the scoped ticket, duplicate writeback refreshes are tenant/workspace-scoped, and the agent action callback route has a static tenant-scope regression test; the current static sweep candidate count is down to 34 remaining findings
- call outbox worker mutations now carry tenant/workspace scope: pending-event locks, sent/failed state transitions, metrics, failed-list reads, and retry paths use scoped predicates, provider delivery receives the locked event scope, and a static tenant-scope regression test covers the outbox SQL surface; the current static sweep candidate count is down to 32 remaining findings
- call transcript job mutations now carry tenant/workspace scope: callback completion passes the resolved call-session scope into transcript-job completion, worker submission/failure writes use the locked job scope, scoped locks/metrics/retries include workspace predicates, and a static tenant-scope regression test covers the transcript job SQL surface; the current static sweep candidate count is down to 29 remaining findings
- call transcript AI job mutations now carry tenant/workspace scope: worker completion and failure writes use the locked job scope, scoped locks/metrics/failed-list reads/retries include workspace predicates, recent flagged joins require matching call-session scope, and a static tenant-scope regression test covers the transcript AI job SQL surface; the current static sweep candidate count is down to 27 remaining findings
- voice call policy rate limits now carry tenant/workspace scope: human and AI outbound-call counters filter `call_sessions` by the same resolved tenant/workspace scope used to queue the call, AI action and human call-entry routes pass scope into policy evaluation, and a static tenant-scope regression test covers the policy SQL surface; the current static sweep candidate count is down to 25 remaining findings
- tenant secret usage tracking now carries tenant/workspace scope: persisted tenant-ingress signing secret and provider-webhook secret `last_used_at` writes require the same resolved scope used for lookup/verification, Twilio/Resend/WhatsApp/Deepgram webhook callers pass matched scope into the mark-used update, and a static tenant-scope regression test covers both secret SQL surfaces; the current static sweep candidate count is down to 23 remaining findings
- admin call dead-letter recovery now carries tenant/workspace scope: list, summary, recover, quarantine, discard, and batch-recover operations filter `call_outbox_events` by workspace as well as tenant, batch recover uses scoped predicates in the dynamic update path, and a static tenant-scope regression test covers the dead-letter route SQL surface; the current static sweep candidate count is down to 22 remaining findings
- admin call webhook rejection telemetry now carries tenant/workspace scope: lead-admin rejection summaries and recent rejection audit-log reads filter by the authenticated admin's workspace as well as tenant, and the API regression test now asserts scoped audit-log SQL parameters; the current static sweep candidate count is down to 20 remaining findings
- admin security posture summaries now carry tenant/workspace scope: agent-integration shared-secret and WhatsApp token encryption aggregates filter by the authenticated admin's workspace as well as tenant, and the API regression test asserts scoped aggregate SQL parameters; the current static sweep candidate count is down to 18 remaining findings
- spam rule management and evaluation now carry tenant/workspace scope: admin list/create/update/delete operations filter or stamp `spam_rules` with the authenticated admin workspace, audit events record the same scope, inbound email spam evaluation reads only rules for the resolved mailbox scope, and API/runtime/static regressions cover the spam-rule SQL surface; the current static sweep candidate count is down to 13 remaining findings
- WhatsApp template management and reads now carry tenant/workspace scope: admin list/save/update/delete operations filter or stamp `whatsapp_templates` with the authenticated admin workspace, non-admin template picker reads only active templates for the signed-in user's workspace, audit events record the same scope, the template uniqueness contract is tenant/workspace-aware, and API/static regressions cover the template SQL surface; the current static sweep candidate count is down to 8 remaining findings
- admin user and password-reset credential flows now carry tenant/workspace scope: lead-admin user updates and reset-link creation prove the target user belongs to the authenticated admin workspace, reset tokens are stamped with the target scope, public reset completion updates `users` and consumes `password_resets` under that stored scope, audit events record the same tenant/workspace, and API/static regressions cover the credential SQL surface; the current static sweep candidate count is down to 4 remaining findings
- inbound email event lifecycle writes now carry tenant/workspace scope: processed and failed state transitions require the event's stored workspace scope, failed-event locks and targeted retries filter by tenant and workspace, retry processing passes locked event scope into storage and terminal updates, and runtime/static regressions cover the inbound event SQL surface; the current static sweep candidate count is down to 2 remaining findings
- auth session lifecycle now carries tenant/workspace scope: logout deletes only the session row matching the token's stored tenant/workspace scope, active session reads require both tenant and workspace alignment with the user row, and runtime/static regressions cover the auth-session SQL surface; the current static sweep candidate count is down to 1 remaining finding
- agent draft writes now carry tenant/workspace scope: the draft table has explicit tenant/workspace columns and indexes, legacy rows are backfilled from their ticket scope, draft creation inserts only through a matching ticket plus same-tenant integration, draft reads/updates require draft and ticket scope alignment, action callbacks pass the authenticated agent workspace into draft creation, and runtime/static regressions cover the draft SQL surface; the static tenant query-scope sweep now has 0 remaining findings
- runtime tenant-query enforcement now exists at the shared Postgres boundary: `db.query` and clients returned by `db.connect()` run through `TENANT_QUERY_GUARD_MODE`, production defaults to strict mode, production env validation rejects disabling it, and the focused tenant-isolation suite includes guard regression coverage
- tenant export/offboarding data coverage now includes the newer auth and voice evidence surfaces: tenant security policies, auth sessions, auth identity accounts, MFA factors/enrollments/challenges, password resets, voice operator presence, voice consent events, and call review writebacks are part of the tenant export table map, tenant isolation audit coverage, or runtime query guard as appropriate
- tenant offboarding now has a privileged-access admin route and backend service for versioned dry-run plans plus executable anonymization: plans return row-count evidence, exact confirmation text, blockers, legal-hold counts, table-level actions, and residual risks; execution requires tenant-admin MFA or a break-glass grant, exact `ANONYMIZE tenant/workspace` confirmation, a concrete reason, legal-hold clearance, a non-`primary` scope, a single transaction, and an audit event
- tenant offboarding rehearsal evidence now has a read-only release capture path: `npm run rehearse:tenant-offboarding -- --tenant=<tenant> --workspace=<workspace>` inspects the live Postgres catalog, proves target tenant/workspace existence, validates expected tenant/workspace scope columns, counts all covered tables, flags legal-hold blockers, warns on R2 object references requiring object-destruction handling, records global Better Auth adapter residual risk, and writes redacted JSON evidence under `.launch-evidence/tenant-offboarding/`
- shared-secret machine ingress now has a fail-closed scope gate: ticket creation, inbound maintenance jobs, email/WhatsApp outbox jobs, call outbox jobs, and transcript jobs require explicit `x-6esk-tenant` plus `x-6esk-workspace` when `TENANT_INGRESS_REQUIRE_SCOPE=true` or `NODE_ENV=production`, instead of silently falling back to `primary`
- shared-secret machine ingress can now require signed tenant envelopes: when `TENANT_INGRESS_REQUIRE_SIGNATURE=true` or `NODE_ENV=production`, tenant/workspace headers must be backed by an HMAC over tenant, workspace, method, path/query, and timestamp, using a tenant/workspace signing-secret map and a replay window
- maintenance scripts and the combined jobs runner now generate the same signed tenant envelopes from `TENANT_INGRESS_TENANT`, `TENANT_INGRESS_WORKSPACE`, and tenant signing-secret configuration, so strict production ingress can be enabled without breaking retry/outbox/transcript worker calls
- tenant ingress signing secrets now have a persisted lifecycle foundation: lead-admin APIs can list redacted metadata, rotate encrypted tenant/workspace signing secrets with one-time plaintext return, revoke old secrets, audit lifecycle events, and let production machine ingress verify against active/retiring DB-backed secrets after env-map fallback
- signed tenant-ingress operations now have a release drill and runbook: `npm run drill:tenant-ingress` verifies that a fresh signed metrics request succeeds and a path/query replay is rejected, and `docs/tenant-ingress-signing-runbook.md` defines rotation, distribution, failure handling, rollback, and launch evidence
- signed tenant-ingress drill evidence now has a release capture path: `npm run drill:tenant-ingress:evidence` writes a redacted JSON artifact under `.launch-evidence/tenant-ingress/` with tenant/workspace, strict expectations, tested paths, statuses, and replay rejection result without storing secrets or signatures
- public portal/webchat ingress now has fail-closed tenant origin resolution: production requires the request origin/host to map to exactly one tenant/workspace through `TENANT_PUBLIC_INGRESS_ORIGINS_JSON` or `tenant_public_ingress_origins`, and `/api/portal/tickets` tenant-stamps tickets, messages, R2 object keys, ticket events, customer resolution, tags, and agent events before writing
- lead-admin APIs now exist to list, create, update, verify/mark, and soft-disable tenant/workspace-scoped public portal/webchat origins, with normalized origin keys, conflict handling for globally active origins, and audit logs for each customer-managed domain lifecycle change
- inbound email and WhatsApp provider routing now fails closed in strict/production mode when recipient mailbox, WABA id, or provider phone number lookup does not resolve exactly one tenant/workspace before writing inbound webhook state
- tenant provider webhook secrets now have a persisted lifecycle foundation: lead-admin APIs can list redacted metadata, rotate encrypted tenant/workspace provider secrets with one-time plaintext return, revoke old secrets, audit lifecycle events, and let strict WhatsApp/Resend/Twilio webhook ingress require scoped secrets while keeping global env secrets as compatibility fallback outside strict mode
- Twilio voice, queue, status, and recording callbacks now use tenant/workspace scoped `twilio/auth_token` secrets in strict mode, resolving tenant ownership from provider numbers for inbound voice and from existing call sessions for follow-up callbacks before mutating call state
- managed STT ingress now uses tenant/workspace scoped provider secrets in strict mode: transcript workers submit jobs with scoped `managed_stt/http_secret` and `deepgram/callback_token`, the Deepgram adapter rejects missing tenant HTTP secrets before submitting audio, and `/api/calls/transcript` validates Deepgram callbacks against the tenant callback token before attaching transcript artifacts
- inbound voice routing now has tenant-owned `call_provider_numbers` records for provider phone/account ownership; new Twilio/generic inbound calls resolve tenant scope from destination phone or provider account and reject unresolved/ambiguous strict-mode routes before creating call sessions or ringing operators
- lead-admin APIs now exist to list, create, update, and soft-disable tenant/workspace-scoped voice provider numbers, with normalized phone storage and audit logs for each ownership change
- focused tenant-isolation regression coverage now verifies tenant-stamped ticket creation, tenant-filtered ticket reads, tenant-scoped mailbox uniqueness, and tenant-scoped external user link upserts
- shared ticket and customer helper reads now require workspace scope as well as tenant scope for ticket lookup, ticket lists, ticket messages/events, customer lookup, customer identity listing, customer history, and customer-to-ticket attachment; this closes the workspace-broad helper gap that could otherwise undercut user APIs and Dexter privacy controls inside the same tenant

Still required for pre-deploy code handover:
- the tenant-isolation foundation is strong, but the final branch still needs clean local release evidence and a documented boundary decision for what remains guarded by runtime SQL enforcement rather than repository/RLS enforcement
- the static tenant query-scope sweep is clean in the tracked surface, but runtime cross-tenant tests still need to stay expanded across drafts, bulk email, resend flows, admin dead-letter handling, analytics/read models, exports, support tooling, macros/saved views, call/WhatsApp/email outbox workers, transcript worker metrics/retries, and object-storage access checks
- cross-tenant integration tests must cover user APIs, admin APIs, workers, queues, object storage, exports, analytics, and support access before external tenant data is onboarded
- privileged-access enforcement must remain explicit for any route that intentionally admits internal support or break-glass users

Deferred to deploy/testing evidence:
- provider-to-tenant routing still needs actual production evidence captured for each launch tenant before external traffic, but the read-only rehearsal command is wired and checks ambiguous ownership plus missing tenant-scoped provider secrets for Resend, WhatsApp, Twilio, managed STT/Deepgram, and public origins
- production migration execution evidence, database audit secret/environment configuration, post-migration verification evidence, production SSO/OAuth activation review, release-captured offboarding rehearsal evidence, tenant ingress signing evidence, object-storage access checks, and tenant-scoped audit visibility evidence are still required after deploy/test environment access exists

Deferred to post-launch lifecycle hardening:
- physical tenant delete, production R2 object-destruction rehearsal, backup/restore drill evidence, and broad lifecycle operations are preserved as requirements but are no longer local pre-deploy code blockers unless a code safety gap is discovered

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

### Selected Auth Direction
- use Better Auth as the embedded open-source auth foundation for first-party SaaS identity because it is TypeScript-native, MIT-licensed, and has plugin coverage for social/OIDC, sessions, organizations, and MFA
- preserve the current `getSessionUser` application boundary during migration so API authorization, tenant isolation checks, and tests do not have to be rewritten all at once
- support Google and Microsoft first, with tenant/domain-aware login resolution before a session is created
- keep password auth only as an explicitly allowed tenant policy or break-glass/local-admin path; external tenants should be able to enforce SSO
- model Keycloak-compatible OIDC as the later enterprise broker path for customers that need heavier IAM, SAML, directory federation, or externally owned identity lifecycle management
- keep 6esk-owned authorization separate from identity-provider authentication; provider group claims may inform roles, but tenant-scoped roles and permissions remain app-owned and deny-by-default

### Session And Cache Direction
- store session truth in Postgres so tenant scope, revocation, auditability, and credential-reset invalidation remain durable
- use a Redis-compatible cache abstraction for rate limits, short-lived auth challenge state, provider nonce/state storage, and session freshness acceleration
- support Valkey as the open-source self-hosted cache target and Upstash Redis as the serverless managed cache target
- production must fail closed for auth/rate-limit flows when the configured cache is required but unavailable
- session/device visibility must include created time, last seen time, auth provider, user-agent/device metadata, IP fingerprint, revocation state, and tenant/workspace scope

### Implementation Sequence
1. Add auth foundation schema for linked provider accounts, tenant security policies, MFA factors, and revocable session metadata.
2. Add environment validation for Better Auth, Google, Microsoft, OIDC broker mode, MFA policy, and cache-provider settings.
3. Close credential-reset session revocation so password reset invalidates active sessions immediately.
4. Add auth audit events for login success/failure, logout, session revoke, MFA challenge, and role/security-policy changes.
5. Implement Google and Microsoft login behind the existing session boundary with strict tenant/domain resolution.
6. Add tenant admin controls for allowed domains, SSO enforcement, MFA requirement, session lifetime, and session revocation.
7. Add Keycloak-compatible generic OIDC broker support after Google/Microsoft are stable.

### Current Auth Progress
- Better Auth `1.6.13` is installed and pinned as the open-source auth foundation; the install uses npm legacy peer resolution only to avoid an unused optional TanStack Start/Vite peer conflict
- Kysely is pinned to `0.28.17`, inside Better Auth's declared peer range, because Better Auth `1.6.13` currently imports Kysely migration constants that are not exported by `0.29.2` during the Next production build
- Better Auth route exposure is intentionally gated by `AUTH_BETTER_AUTH_ROUTE_ENABLED` and `AUTH_BETTER_AUTH_DB_BRIDGE_READY` so OAuth cannot be enabled before the tenant-safe database/session bridge exists
- Better Auth now has dedicated adapter tables, a guarded `/api/auth/better` route, Google/Microsoft social provider wiring, generic OIDC provider wiring, and a tenant-safe bridge that only mints a 6esk session after domain policy, tenant policy, and active app-user checks pass
- admin security now reports Better Auth package readiness, configured Google/Microsoft/OIDC providers, cache posture, MFA/session policy state, and current blockers without exposing provider secrets
- login now discovers only ready federated providers, and admin security includes current-user session visibility plus user-driven session revocation
- password-reset completion now revokes active sessions for the affected tenant/workspace user and writes revocation audit evidence
- tenant-admin security policy controls now exist in the admin security surface and `/api/admin/security/policy`: lead admins can manage allowed login domains, SSO enforcement, admin MFA requirement, session lifetime, auth provider mode, and OIDC issuer; updates are tenant/workspace-scoped and audit logged
- new sessions now read `tenant_security_policies.session_ttl_days` for the user's tenant/workspace before writing the auth session expiry, so session lifetime policy is enforced at session creation instead of only displayed in admin
- privileged support and break-glass access now has a durable tenant/workspace-scoped grant lifecycle: `privileged_access_grants` stores subject email/name, access type, reason, reference, requested duration, approval/revocation users, expiry, status, and audit metadata; the table is included in tenant query guard/sweep, tenant isolation audit, and tenant export surfaces
- `/api/admin/security/privileged-access` lets lead admins list, request, approve, and revoke privileged grants; support and break-glass transitions record tenant-visible audit events, and break-glass approval requires an active admin MFA factor plus an approval note
- privileged access is now enforced on high-risk tenant-data reads: `resolveTenantDataAccess` centralizes lead-admin versus internal-support authorization, tenant export requires an active `break_glass` grant for internal support, tenant audit-log reads allow active `support` or `break_glass` grants, grant usage emits `privileged_access_used`, export audits record access mode/grant id, and audit-log reads are workspace-scoped
- auth audit coverage now includes password login success/failure, MFA-completed login success, and user logout: failed login events are tenant-scoped and avoid raw email storage, MFA challenge verification records the final `auth_login_success`, logout records `auth_logout` against the active session, and stale/anonymous logout still clears the cookie without fabricating an audit actor
- privileged grant alerting and post-event review now exist: request/approve/revoke attempts call the `SECURITY_ALERT_WEBHOOK`, persist delivered/missing/failed alert outcomes in tenant-scoped grant metadata, write tenant-visible alert audit events, require `SECURITY_ALERT_WEBHOOK` in production env validation, expose latest alert status and review debt in Admin security, and allow lead admins to record post-event reviews for expired/revoked grants
- privileged MFA edge enforcement now covers the highest-risk admin/support operations: MFA is required for lead-admin, internal-support, support-admin, and break-glass roles; session context carries the auth provider; MFA-incomplete sessions are blocked from tenant export, audit-log reads, security-policy updates, privileged grant mutations, admin configuration writes, AI prompt/knowledge mutations, provider number changes, WhatsApp template changes, user/admin mutations, tenant ingress secret/origin changes, and manual queue/dead-letter trigger paths; read-only security bootstrap remains available so admins can complete enrollment
- lead-admin admin authorization is now centralized through `src/server/auth/admin-guard.ts`: `requireLeadAdminAccess` applies tenant scope and optional sensitive-session MFA for human admins, while `requireLeadAdminOrMachineAccess` keeps service-to-service outbox/retry/alert routes available only through configured shared secrets plus tenant ingress scope/signature, and blocks logged-in non-admin users from falling through to machine authorization
- the admin security surface now shows privileged-access stats, request form, approval note, revoke reason, and pending/active grant actions, with demo/mock API parity for policy and privileged-access routes
- focused auth/tenant coverage now includes `tests/auth-login-mfa-api.test.ts`, `tests/auth-mfa-api.test.ts`, `tests/auth-logout-api.test.ts`, `tests/sensitive-session.test.ts`, `tests/admin-guard.test.ts`, `tests/tenant-security-policy.test.ts`, `tests/admin-security-policy-api.test.ts`, `tests/privileged-access.test.ts`, `tests/privileged-access-alerts.test.ts`, `tests/privileged-access-authorization.test.ts`, and `tests/admin-privileged-access-api.test.ts` in `npm run test:tenant-isolation`
- Vitest/Vite audit remediation is complete: Vitest is upgraded to `4.1.8`, Vite resolves to `8.0.16`, esbuild resolves through the patched Vite chain, and PostCSS is overridden to `8.5.15`
- current verification on 2026-06-05: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:tenant-isolation` (78 files, 269 tests), `npm run test:ai-safety` (7 files, 46 tests), `npm test` (182 files, 734 tests), `npm audit --audit-level=high`, `npm run audit:tenant-query-scope` (272 files, 680 query calls, 550 scoped calls, 0 findings), and `git diff --check` pass; Git reports only expected Windows CRLF normalization warnings
- still outstanding: production OAuth/provider smoke evidence, release-environment session/cache drills, and any future routes that intentionally admit internal support roles must use explicit active-grant enforcement rather than broadening ordinary lead-admin APIs

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

Completed local code:
- workspace module entitlements now fail closed when `ENTITLEMENTS_FAIL_CLOSED=true` or in production: missing module configuration or a database read failure disables billable modules instead of falling back to enabled defaults
- module entitlement JSON remains backward-compatible with boolean flags but now supports structured states such as `active`, `disabled`, `suspended`, and `downgrade_pending`, so downgrade/suspend controls can stop new usage without deleting records
- billable usage metering now fails closed under `ENTITLEMENTS_FAIL_CLOSED=true`, `MODULE_METERING_FAIL_CLOSED=true`, or production, so metering write failures are no longer silently hidden under the launch safety posture
- production env validation now requires `ENTITLEMENTS_FAIL_CLOSED=true` and `MODULE_METERING_FAIL_CLOSED=true`, and `.env.example` documents both flags
- the admin workspace usage API now returns tenant/workspace-scoped daily usage buckets, and the admin Workspace tab renders a stacked module-usage chart plus per-module actor/kind breakdown cards
- a server-owned billing catalog now defines the v2 modular CRM quote shape for Core OS, WhatsApp, Voice, AI Orchestration, and Vanilla Webchat, with configurable `BILLING_VAT_RATE_PERCENT` validation
- `/api/admin/workspace/usage/export` now provides a lead-admin-MFA-gated tenant/workspace-scoped usage export in JSON or CSV, includes quote data, omits customer/contact identifiers, and audits export metadata without row payloads
- billing lifecycle persistence now exists in migration `0059_billing_lifecycle.sql`: tenant/workspace-scoped subscriptions, plan changes, invoices, manual adjustments, and dunning events are the local source of truth, with finance-admin role seeding and workspace foreign keys
- `src/server/billing/lifecycle.ts` now owns deterministic plan-change/proration calculations, subscription lifecycle changes, manual credits/refunds/write-offs/plan overrides, collections/dunning events, invoice state transitions, and customer-safe invoice export data without live payment-provider calls
- `/api/admin/workspace/billing` now exposes the billing lifecycle surface behind `lead_admin` or `finance_admin` MFA access, passes tenant/workspace scope into every service call, and audits invoice export metadata without row payloads
- billing suspension now syncs workspace module entitlements into suspended state, and billable usage metering checks module entitlement before recording usage under the fail-closed launch posture
- billing lifecycle tables are included in the tenant query guard, static query-scope sweep, tenant export, tenant isolation audit, and offboarding rehearsal inventories
- focused regression coverage now includes `tests/workspace-modules-entitlements.test.ts`, `tests/module-metering-fail-closed.test.ts`, `tests/admin-workspace-usage-export-api.test.ts`, `tests/billing-lifecycle.test.ts`, and `tests/admin-workspace-billing-api.test.ts` in `npm run test:tenant-isolation`

Still required for pre-deploy code handover:
- no remaining local billing lifecycle code blocker is identified in this workstream after the 2026-06-06 focused checks; final release verification must still stay green on the whole branch before deploy/testing handover

Deferred to deploy/testing/post-launch evidence:
- provider-spend reconciliation must compare billable usage against actual provider charges after deploy credentials, provider dashboards, and real provider invoice evidence exist; this is not a local code-completion blocker for the current ready-to-deploy handover

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
Dexter-owned AI capability must remain an optional `6esk` module with no hidden internal-platform dependency.

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
- human review is a `hybrid_review` policy behavior, not a hidden global fallback; `full_auto` must still be bounded by tenant policy, tool policy, denial, rollback, and audit controls
- customer-facing Dexter sessions must be bound to a single tenant, workspace, channel, active ticket/thread, and current customer context before any model prompt, retrieval, or tool action is built
- no customer OTP or 6esk-owned customer verification step is planned for live call/email/chat launch; customer identity assurance is a tenant business responsibility, while 6esk verifies tenant users, tenant admins, machine integrations, channel ownership, and tenant/workspace boundaries
- for email and WhatsApp, Dexter may treat the tenant-resolved channel identity as sufficient to support that customer's active and historical CRM context, because the tenant is responsible for customer identity collection and channel consent
- for voice, Dexter may continue after the call notice/recording-consent script is accepted; phone-based support must use the tenant-resolved customer record and recorded-call consent rather than OTP step-up
- same-customer history is an intended customer-support capability, not only an internal routing aid; Dexter should be able to discuss the customer's own prior tickets, trade/order/service history, support notes appropriate for customer visibility, and current resolution state when those records are bound to the same tenant/workspace/customer context
- customer profile data such as phone, email, address, account identifiers, billing identifiers, and private identity metadata should be minimized in replies and only used or repeated when required to complete the customer's support task or route them to the tenant's approved channel
- other-customer and other-tenant data is never eligible context, even when the requested information is non-identifying or the customer attempts prompt injection

### Customer-Facing AI History Stance
`6esk` is a CRM operating system for tenants helping their own customers. The platform must not add friction that makes normal support workflows unusable, so customer-facing Dexter must support customer history without an OTP requirement.

Requirements:
- tenant/user verification is a 6esk platform responsibility; customer verification is a tenant operating responsibility
- tenant integrations must resolve every inbound call, email, WhatsApp, or chat into tenant key, workspace key, channel, active conversation/ticket where possible, and the best-known customer record
- once a same-customer context is resolved, Dexter may answer questions about that customer's own active case and prior CRM history across enabled modules, including ticket history, trade/order/service status, previous resolutions, and relevant tenant-approved business knowledge
- Dexter must never use a customer request to widen scope from the resolved customer to another customer, another tenant, all customers, mailbox-wide history, analytics exports, raw databases, or hidden agent/runtime data
- if customer identity is ambiguous, conflicted, or linked to multiple possible customer records, Dexter should avoid disclosing history and should create a clarification/handoff path instead of guessing
- voice flows must begin with tenant-approved recording/monitoring notice text; once accepted, the call can proceed without OTP
- email, WhatsApp, and webchat flows rely on the tenant's channel onboarding and identity-resolution rules; 6esk should provide configurable tenant policy controls but should not force customer OTP by default
- customer-visible history should be filtered to information appropriate for the customer, not internal-only notes, hidden agent analysis, provider secrets, operator-only audit trails, or unrelated customer data
- all customer-history answers must be traceable to allowed source records in the command envelope or retrieval context so output validation can reject answers sourced from outside the resolved customer boundary
- tenants should be able to configure stricter customer-history disclosure rules later, but the default launch posture is CRM-useful same-customer history with hard tenant/customer isolation

### AI Prompt-Injection Defense Pipeline
Prompt injection must be handled as a production security boundary, not as prompt wording. The AI runtime needs a layered pipeline between user/customer-controlled content, retrieved knowledge, model prompts, tool execution, and persisted outputs.

Runtime flow:
`raw input -> sanitization/gate -> guard classifier -> structured prompt sandbox -> model plan -> tool-policy validator -> tool execution -> output/action validator -> audit/telemetry/red-team feedback`

Required layers:
1. Input sanitization and gate layer
   - enforce per-channel maximum lengths, file-size limits, accepted content types, and field-specific character policies
   - strip or reject control characters, zero-width characters, suspicious homoglyph use, malformed Unicode, and binary-looking text where the channel does not require it
   - detect known prompt-injection phrasing such as attempts to override instructions, reveal prompts, impersonate developers/system roles, force repetition of hidden text, or disable safety/tool rules
   - segment untrusted content from trusted metadata before retrieval or prompting so customer text cannot become runtime instruction text
2. Input classifier and guard policy
   - add a fast rule/model guard that labels inputs, retrieved snippets, and uploaded knowledge as clean, suspicious, malicious, or needs-review
   - store guard decisions with tenant key, workspace key, source channel, policy mode, reason code, classifier version, and request/run id
   - in `hybrid_review`, route suspicious high-impact requests to review; in `full_auto`, reject, downgrade capability, or continue with read-only/no-tool mode instead of silently creating a human approval dependency
3. Prompt-template and sandbox layer
   - build prompts from structured envelopes rather than free-text concatenation
   - delimit user content, retrieved SOPs, conversation history, system policy, and tool schemas with typed sections that the model is instructed to treat differently
   - include a server-built customer privacy context with allowed tenant, workspace, ticket, thread, customer, and source ids; model text must never be allowed to expand this context
   - include customer-visible history as a distinct typed section so the model can support continuity while validators can keep internal-only notes, other-customer records, and hidden policy out of customer replies
   - version prompt templates and critical constraints, with rollout, rollback, audit history, and tenant-specific policy overlays
   - repeat non-negotiable constraints at the action boundary: never reveal system/developer prompts, never execute tools outside the validated capability set, never use untrusted content as instruction authority
4. Capability and tool-policy layer
   - require the model to emit a structured plan/tool request before any state change, provider call, outbound send, export, merge, billing event, or knowledge mutation
   - validate requested tools against tenant entitlements, user/agent permissions, policy mode, resource ownership, rate limits, destination allowlists, and idempotency keys
   - make tool policy deny-by-default, tenant-scoped, and independent from model text; the model can request capability but cannot grant itself capability
   - separate read-only, draft, reversible write, irreversible write, and external-send tool classes so policy can bound `full_auto` without degrading every workflow to manual approval
5. Output and action validator
   - validate final responses, structured outputs, command envelopes, and state transitions against schemas before persisting or executing them
   - scan outputs for leaked prompts, secrets, provider tokens, PII overexposure, cross-tenant identifiers, unsupported legal/compliance claims, and unsafe instructions to users/operators
   - require source references or confidence metadata for knowledge-backed answers where the operator/customer needs traceability
   - record denials, downgrades, schema failures, and sanitized outputs as first-class run events
6. Monitoring, logging, and red-team loop
   - log prompts, retrieved snippets, tool requests, policy decisions, outputs, and denials with PII redaction, tenant/workspace scope, correlation id, and retention policy
   - alert on repeated injection attempts, abnormal tool-denial spikes, cross-tenant guard violations, suspicious retrieval patterns, unusual outbound attempts, and model-output schema failure rates
   - maintain adversarial eval suites for direct prompt injection, indirect retrieval injection, data poisoning, tool-call abuse, prompt leakage, cross-tenant exfiltration, and BYO-provider edge cases
   - feed confirmed incidents, near misses, and red-team payloads back into guard rules, classifier training data, prompt templates, and tool-policy tests

Implementation plan:
1. Define `ai_guard_events`, `ai_policy_decisions`, and prompt/template version records with tenant/workspace keys, request ids, run ids, classifier versions, policy mode, decision, reason, and retention owner.
2. Centralize AI input normalization and injection scoring so uploads, chat messages, ticket context, transcripts, retrieved knowledge, and agent callbacks use the same guard contract.
3. Wrap Dexter command envelopes with a pre-tool policy validator that checks tenant ownership, entitlements, permissions, tool class, destination, idempotency, and policy mode before dispatch.
4. Add output validators for command envelopes, customer-visible replies, operator-visible drafts, knowledge mutations, and external-send payloads.
5. Add a customer privacy firewall for live channels that allows resolved same-customer CRM history, blocks cross-tenant/cross-customer scope expansion, handles ambiguous customer identity with clarification or handoff, and minimizes unnecessary profile-PII repetition before drafts or sends can persist.
6. Build a tenant-scoped AI Security page in admin showing guard events, tool denials, prompt/template versions, run-level replay evidence, policy mode, blocked payload samples with redaction, and model/provider health.
7. Add regression tests and red-team fixtures for every layer before enabling `full_auto` for external tenants.

Acceptance criteria:
- prompt injection cannot cause Dexter to reveal hidden prompts, bypass tenant/permission checks, call unentitled tools, send unauthorized outbound messages, or access another tenant's knowledge/files
- every AI tool call is explainable from a tenant-scoped command envelope, policy decision, run ledger entry, and audit event
- `hybrid_review` creates human approval tasks only where tenant policy requires them; `full_auto` remains autonomous but bounded by hard policy denies, downgrades, idempotency, rollback strategy, and alerts
- knowledge-base uploads and retrieval snippets are screened for direct and indirect injection before they can influence a tool-capable prompt
- customer-facing AI cannot reveal another customer's ticket, query topic, conversation content, contact details, or profile fields, including within the same tenant/workspace
- customer-facing AI can help with the resolved customer's own active thread and prior CRM history without OTP when the channel/customer context is tenant-resolved and not ambiguous
- customer-facing AI does not require OTP for call, email, WhatsApp, or chat; voice relies on the tenant-approved call recording/monitoring notice, while email/WhatsApp/chat rely on tenant-managed channel identity and consent
- customer-facing AI minimizes profile/account identifiers and repeats them only when needed for the support task or approved tenant workflow
- guard decisions and validator failures are visible in tenant-safe admin diagnostics and security telemetry without leaking sensitive payloads across tenants
- launch testing includes direct prompt injection, indirect RAG injection, poisoned SOP uploads, hostile transcript content, model-output schema violations, cross-tenant exfiltration attempts, cross-customer history probes, ambiguous-customer identity probes, same-customer history support scenarios, profile-PII minimization probes, BYO-provider behavior, and tool-abuse scenarios

### Explicit Commercial Rule
BYO AI should reduce customer cost materially, but 6esk still owns:
- orchestration
- policy enforcement
- safety rails
- routing/runtime layer
- auditability

### Current AI Production-Readiness Implementation Status
Updated: 2026-05-27.

Implemented foundation:
- canonical AI policy mode handling now distinguishes `hybrid_review` from `full_auto`, while still accepting legacy `draft_only` and `auto_send` values during migration
- agent outbox events now carry typed `agent-command.v1` command envelopes with run id, command type, lane key, tenant key, policy mode, resource, payload, and idempotency metadata
- outbound agent dispatch now uses lane-aware selection so only the oldest eligible event per resource lane is selected in a worker pass
- durable agent run tables now exist for runs, run events, run steps, and tool calls
- outbound agent dispatch now creates run and run-event records, and action callbacks can populate run steps/tool calls when the agent includes a run id in action metadata
- lead-admin diagnostics can read recent agent runs through `/api/admin/agents/[agentId]/runs`
- admin knowledge-base backend APIs now exist for folders, document upload, publishing, and search under `/api/admin/ai/knowledge/*`
- admin knowledge-base routes now use authenticated tenant/workspace scope for folders, documents, publish actions, retrieval searches, and retrieval diagnostics instead of falling back to the compatibility `primary` scope
- knowledge folder parent references and document folder references are validated inside the same tenant/workspace before write, preventing cross-tenant folder attachment by guessed UUID
- knowledge folder creation, document upload, and document publish actions now emit tenant/workspace-scoped audit logs with non-content metadata for operator accountability
- knowledge ingestion now has a pluggable malware scanner contract that fails closed when scanning is required, records rejected uploads in tenant/workspace-scoped quarantine events, and stores retention metadata on accepted documents
- rejected Knowledge Base uploads can now optionally persist their raw rejected bytes to R2 under tenant/workspace-scoped quarantine keys, with provider, bucket, key, timestamp, checksum, and scanner/reason evidence surfaced in admin diagnostics
- PDF, DOC, and DOCX Knowledge Base uploads now have a bounded extractor-service contract: files are malware-scanned first, extractor failures reject and quarantine the upload, and successful extraction stores extractor metadata with the accepted document
- knowledge retention enforcement can now preview expired documents, delete expired document chunks, blank stored document body text, mark documents deleted, and write tenant/workspace-scoped audit logs while preserving legal-hold skips
- lead admins can now enable or release Knowledge Base document legal holds from the tenant-scoped admin surface, with retention metadata updates and audit logs for every hold/release action
- lead admins can now create audited tenant-scoped Knowledge Base JSON exports containing folders, document metadata/body text, and retrieval chunks, with export counts and options recorded in audit logs
- the admin Knowledge tab now supports folder creation, text/Markdown upload, document status and publish controls, legal-hold administration, audited JSON export, retrieval search, recent retrieval diagnostics including result counts and unsafe-chunk filtering evidence, and recent quarantine-event review
- a tenant/organization/workspace compatibility foundation now exists for the AI/control-plane surface, with seeded `primary` records, tenant/workspace keys on integrations and module usage, and FK guards for agent and knowledge-base tables
- knowledge upload accepts text, Markdown, PDF, DOC, and DOCX through scanner/extractor gates, rejects binary-looking text, rejects prompt-injection-like content, and enforces per-workspace document/byte quotas
- a central AI guard now normalizes/sanitizes AI-controlled text, classifies suspicious or malicious instruction-control language, and records tenant-scoped `ai_guard_events`
- tenant-scoped `ai_policy_decisions` now record agent tool policy checks before `/api/agent/v1/actions` executes state-changing tools
- full-auto agent dispatch now blocks unsafe prompt-injection payloads before Dexter receives a tool-capable command; hybrid-review dispatch annotates the command with safety context instead of silently escalating full-auto to human approval
- agent-generated reply/review outputs now pass through an output validator before being persisted, drafted, sent, or returned from the action callback
- Dexter command envelopes now carry a structured `agent-prompt-sandbox.v1` prompt sandbox with separated system constraints, tenant policy, runtime context, untrusted event payload, and untrusted retrieved knowledge sections
- Dexter/agent callback ingress now uses the same fail-closed signed tenant envelope as other machine ingress in strict/production mode, preserves workspace scope on authenticated agent requests, tenant-stamps AI review/merge side effects, and rejects call-review writebacks unless the call session belongs to the scoped ticket
- the initial `dexter_agent_runtime` prompt template is cataloged in the migration path with a versioned template key, version, body, and hash so future runs can be replayed against the prompt contract that was active when they were issued
- admin automation diagnostics now expose tenant-scoped guard events, policy decisions, blocked/review/read-only counts, and redacted guard samples for operator triage
- lead-admin run replay now returns tenant-scoped prompt sandbox, template catalog evidence, run events, steps, tool calls, guard events, and policy decisions for a specific Dexter run
- the admin recent-runs panel can load replay evidence and copy a redacted replay JSON bundle for incident review or operator escalation
- Dexter runtime prompt selection now reads the tenant/workspace active `dexter_agent_runtime` template from the prompt-template catalog with a code fallback if the catalog is unavailable
- lead-admin prompt-template rollout APIs now support listing template versions, creating draft versions, activating a specific version, and rolling back to the most recently retired version, with audit and prompt-template event records
- the admin automation diagnostics panel now surfaces prompt-template versions and activation/rollback controls for operator-managed AI safety rollout
- an AI red-team regression fixture suite now covers direct prompt injection, indirect RAG poisoning, prompt leakage, tool-policy bypass, secret exposure, external data exfiltration, cross-tenant exfiltration, memory-persistence attempts, and safe business content
- `npm run test:ai-red-team` now runs the release-gate subset for guard classification, tool policy, output validation, knowledge safety, and prompt sandbox trust boundaries
- `npm run test:ai-safety` now runs TypeScript typechecking plus the AI red-team release-gate suite, and `.github/workflows/ai-safety.yml` runs it for PRs to `main`, pushes to `main`/`codex/merge-v1-roadmaps`, manual dispatches, and a daily scheduled safety regression check
- the AI guard regression suite now includes initial long-context instruction smuggling, multilingual instruction override, and hostile provider/tool-call-shaped output coverage
- published knowledge retrieval is tenant/workspace-key scoped, records retrieval audit events, and uses Postgres full-text search as the first local retrieval path
- knowledge retrieval now screens search queries and retrieved snippets for direct or indirect prompt injection before they can be attached to Dexter command envelopes
- Dexter command envelopes can now include tenant-scoped published knowledge context from the knowledge base, capped per retrieval result, so agent actions can use customer SOPs without broadening cross-tenant access
- Dexter command envelopes now include a server-built `agent-customer-context.v1` privacy context with tenant, workspace, channel, active ticket/thread, current customer, ambiguity state, and allowed source ids; prompt sandboxing places that context in an authoritative `customer_privacy_context` section outside untrusted event payload text
- the agent output validator now enforces customer-visible privacy boundaries before drafts or sends persist: it blocks out-of-scope source ids, profile PII overexposure, unresolved/ambiguous/conflicted history disclosure, and generated language that expands scope to another customer, tenant, workspace, mailbox-wide data, analytics-wide data, raw database records, or hidden runtime state
- local guard hardening now covers encoded-instruction smuggling, Afrikaans/South-African override phrasing, and prompt-canary leakage; leaked canary samples are redacted in diagnostics as `[REDACTED_PROMPT_CANARY]`
- `npm run test:ai-safety` now passes with the customer-context and expanded prompt-injection coverage included: typecheck plus 7 AI safety test files, 46 tests

Still required for pre-deploy code handover:
- `tenant_key = primary` is still a compatibility bridge for un-migrated paths; local code work must keep tenant/workspace/org coverage, backfill tooling, orphan detection, and cross-tenant regression tests aligned before external customer data
- embeddings/vector retrieval can remain a later capability, but the current local retrieval path must keep tenant/workspace scope, guard screening, and source-bound evidence intact
- the prompt-injection defense pipeline has a stronger local rule/canary baseline; remaining work is deeper mutation fuzzing, replay redaction review across every admin diagnostic surface, and live-channel end-to-end scenarios before external traffic
- live customer-facing history safety now has the local source-bound context and validator foundation; remaining pre-deploy work is any required handoff UX/action behavior for ambiguous identity and end-to-end live-channel scenarios proving the same-customer history path behaves correctly before external traffic

Deferred to deploy/testing evidence:
- production scanner and document-extractor service deployment, production R2 quarantine bucket provisioning/lifecycle policy, production export object-payload rehearsal against real R2 data, production tenant-offboarding rehearsal capture, model/provider evaluation suites, GitHub branch-protection enforcement for the AI safety workflow, and external Dexter worker lifecycle/replay drills require deployed infrastructure or provider/runtime access

Deferred to post-launch lifecycle hardening:
- physical offboarding delete, production anonymization/offboarding execution rehearsal, backup/restore drill evidence, and broader cross-module retention enforcement are preserved as lifecycle requirements but are not immediate local code blockers unless they expose a code safety gap

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

Completed local code:
- API middleware now normalizes an inbound `x-6esk-request-id` / `x-request-id` or generates a bounded request id, forwards it to route handlers as `x-6esk-request-id`, and returns the same id on normal and rate-limited responses
- request-id normalization rejects short, oversized, and control-character values so caller-supplied correlation ids cannot poison response headers or logs
- focused coverage now includes `tests/request-correlation.test.ts`; route-level tenant/workspace audit/event correlation still needs broader adoption as code-owned follow-up

Deferred to deploy/testing evidence:
- external dashboards, alert routing, SLO burn-rate checks, public status workflow, and production telemetry proof require the deploy/runtime environment and should be captured during deploy/testing rather than claimed locally

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

### Financial Control Requirements
- usage records must be tenant-scoped, append-only or reconciliation-safe, and traceable to source events
- provider spend reconciliation must detect abnormal spikes by tenant/module
- billing suspension must stop new billable usage without corrupting historical records or audit trails
- invoices and usage exports must never include another tenant's usage, identifiers, or metadata
- manual credits, refunds, write-offs, and plan overrides require role checks and audit trails

### Current Deploy-Readiness Billing Slice
Done means the local branch is ready to hand to deploy/testing after these code-owned capabilities are implemented and verified:
- subscription persistence has a tenant/workspace-scoped source of truth for plan, module add-ons, billing status, renewal dates, cancellation/downgrade state, and audit metadata
- plan-change/proration behavior can calculate upgrade, downgrade, renewal, and cancellation effects deterministically without calling a live payment provider
- manual credits, refunds, write-offs, and plan overrides use explicit lead-admin or finance-admin authorization and tenant-visible audit events
- collections/dunning state can record overdue, suspended, retry, grace-period, and restored states without destroying historical usage or invoices
- invoice lifecycle covers draft, issued, paid, void, credited, refunded, overdue, and written-off states with tenant/workspace isolation and customer-safe export data
- entitlement and metering enforcement remain upstream of provider calls, queue writes, AI execution, outbound sends, and billable usage recording
- focused tests cover tenant isolation, authorization, state transitions, proration, adjustment auditability, and invoice export safety; broader `typecheck`, `lint`, `build`, full tests, static tenant-query audit, and `git diff --check` pass

Current local status:
- implemented locally on 2026-06-06 through `workspace_billing_subscriptions`, `workspace_billing_plan_changes`, `workspace_billing_invoices`, `workspace_billing_adjustments`, `workspace_billing_dunning_events`, `src/server/billing/lifecycle.ts`, and `/api/admin/workspace/billing`
- tenant/workspace isolation is enforced by runtime query guard registration, static query-scope sweep registration, tenant export coverage, tenant isolation audit coverage, offboarding rehearsal coverage, and focused billing/API tests
- provider reconciliation and live collection are intentionally excluded from this local done state until deployed credentials, provider dashboards, and real provider invoice evidence exist

Out of scope for this local done state:
- live payment-processor collection
- provider-spend reconciliation against deployed credentials or provider dashboards
- production OAuth smoke, provider dashboard validation, R2 checks, branch-protection proof, and production telemetry evidence

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
- AI prompt-injection defense pipeline and tool-policy validation before external AI automation

### Phase 2: commercial architecture foundation
- entitlements
- tenant-safe connectors
- module-safe queues and provider adapters
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
