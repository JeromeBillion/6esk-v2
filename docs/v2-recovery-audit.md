# v2 Recovery Audit

Date: 2026-06-06

## Authority
- Local authoritative workspace: `C:\Users\choma\Desktop\6esk-v2`
- Authoritative remote: `https://github.com/JeromeBillion/6esk-v2.git`
- True v2 baseline: `7624dec`
- Restored main commit: `faaed28`
- Recovery branch: `recovery/v2-retain-all-work`

## Preserved Branches
- `safety/v2-baseline-7624dec`
- `safety/v2-local-dirty-b717f43`
- `safety/wrong-folder-work-491af65`
- `safety/accidental-main-fc91205`

## Merged Into Recovery
- Preserved genuine local v2 work from `b717f43`.
- Removed stale adjacent-product coupling from deploy-facing code/docs/tests/env.
- Converted the old profile lookup bridge into the white-label `external-profile` contract:
  - `src/server/integrations/external-profile.ts`
  - `EXTERNAL_PROFILE_*` env surface
  - generic `external-profile` / `external-profile-cache` lookup provenance
  - `white-label-webchat` metadata source for tenant-owned webchat plugs
- Kept profile cache fallback behavior through `external_user_links`.
- Updated customer resolution, ticket creation, email inbound, WhatsApp inbound, admin metrics, and Dexter escalation metadata to use the generic contract.
- Ported the CRM call E2E harness cleanup:
  - `CRM_CALLS_AGENT_EVENTS_*` replaces legacy downstream observer envs
  - local `agent_outbox` verification is scoped by v2 `CRM_CALLS_TENANT_ID`
  - regression tests cover the generic downstream observation contract
- Semantically ported tenant ingress/provider webhook secret persistence from the wrong-folder work into v2-native `tenant_id` form:
  - `db/migrations/0050_tenant_ingress_provider_webhook_secrets.sql`
  - `src/server/tenant-ingress-secrets.ts`
  - `src/server/provider-webhook-secrets.ts`
  - `src/app/api/admin/tenant/ingress-secrets/route.ts`
  - `src/app/api/admin/tenant/provider-webhook-secrets/route.ts`
  - WhatsApp inbound webhook verification now falls back to tenant-scoped persisted Meta app secrets when the global `WHATSAPP_APP_SECRET` does not validate
  - production env validation for persisted secret encryption keys
  - focused tests for tenant-scoped metadata, rotation, env fallback, tenant-admin route access, one-time plaintext return, audit logging, and fail-closed encryption config
- Semantically ported the auth/session/MFA foundation into v2-native `tenant_id` form:
  - `db/migrations/0051_auth_security_foundations.sql`
  - tenant security policies for allowed login domains, SSO enforcement flags, admin MFA requirement, session TTL, and planned auth-provider mode
  - session metadata for auth provider, device/IP fingerprints, revocation timestamp, and revocation reason
  - TOTP MFA enrollment/challenge tables and dependency-free TOTP verification service
  - password login now respects tenant SSO/domain policy, creates MFA challenges for enrolled privileged users, and gates privileged users into MFA enrollment when required
  - users can list/revoke their own sessions, password resets revoke sessions in place, and tenant admins can read/update tenant security policy
  - focused tests cover policy API access, MFA challenge/enrollment API paths, login policy/MFA boundaries, session revocation, password-reset revocation evidence, and production env validation
- Semantically ported privileged-access grant workflow into v2-native `tenant_id` form:
  - `db/migrations/0052_privileged_access_grants.sql`
  - `src/server/auth/privileged-access.ts`
  - backoffice APIs for grant request/list/stats and internal-admin approve/revoke/post-event review
  - impersonation now requires an MFA-authenticated internal staff session and an active tenant-scoped privileged-access grant for the support user
  - active grant id is recorded on the auth session, impersonation duration is capped by grant expiry, denial/start/end/review events are audited, and security readiness now reports active grants plus grants needing review
- Semantically ported the Google/Microsoft auth-login adapter into v2-native `tenant_id` form:
  - `db/migrations/0053_auth_oauth_login.sql`
  - `src/server/auth/oauth-login.ts`
  - `/api/auth/oauth/authorize` and `/api/auth/oauth/callback`
  - auth OAuth uses identity scopes only and does not create mailbox OAuth connections or persist provider refresh tokens
  - provider identity maps to existing active `users`; `auth_sessions` remains the session source of truth
  - tenant security policy now supports managed `oauth` SSO mode while keeping legacy `better_auth` as a compatibility value
  - OAuth login enforces tenant login-domain policy, rejects unverified Google email claims, records audit events without raw email leakage, and carries MFA provider provenance through `auth_mfa_challenges`
  - the login page now handles password/OAuth MFA challenges before entering the workspace
- Semantically ported billing lifecycle persistence into v2-native `tenant_id` form:
  - `db/migrations/0054_billing_lifecycle.sql`
  - `src/server/billing/lifecycle.ts`
  - tenant billing accounts, subscriptions, subscription items, signed billing adjustments, invoices, invoice lines, and collection/dunning events are tenant/workspace scoped
  - subscription sync derives durable items from the v2 modular pricing catalog and records mid-period proration as a pending adjustment
  - estimated invoices are built from persisted subscription items, tenant-scoped usage events, pending adjustments, and VAT rules
  - internal backoffice billing actions can sync subscriptions, create audited credits/refunds/write-offs/prorations, create duplicate-safe invoice drafts, transition invoice status, and record collection events
  - tenant admins can read current billing lifecycle visibility through the workspace billing API
- Semantically ported AI prompt-safety value without replacing native Dexter:
  - `src/server/ai/prompt-safety.ts`
  - `src/server/ai/knowledge-retrieval.ts`
  - user-controlled runtime prompts are treated as untrusted input, stripped of zero-width/control characters, classified for prompt injection, prompt/canary leakage, secret/token exposure, multilingual overrides, encoded smuggling, RAG poisoning, cross-tenant/customer exfiltration, tool-policy bypass, tool coercion, audit/citation suppression, memory persistence, and role impersonation
  - runtime-style RAG retrieval denies high-risk prompts before knowledge chunk search, downgrades medium-risk prompts to read-only/unsafe-content-filtered behavior, and writes redacted query summaries plus redacted prompt-safety decisions into `knowledge_retrieval_events` without storing the full normalized prompt
  - wrong-folder red-team prompt fixtures were retained as focused v2 prompt-safety regression coverage
  - native Dexter runtime, run ledger, command envelope, and tenant Knowledge Base architecture are preserved
- Semantically ported Dexter control-plane command envelope value without replacing native Dexter:
  - `src/server/agents/command-envelope.ts`
  - `src/server/agents/run-ledger.ts`
  - the v2 command protocol now validates `agent.run.create`, `agent.run.cancel`, `agent.wait`, `agent.tool.requested`, `agent.tool.completed`, `agent.approval.requested`, and `agent.run.completed` envelopes with bounded command data
  - run-ledger helpers can append tenant-bound cancel/wait/tool/approval/completion envelopes into `agent_run_events`
  - completed agent deliveries now persist a validated `agent.run.completed` envelope, while outbox-created runs continue to persist `agent.run.create`
  - wrong-folder event-to-command mapping behavior was retained as focused v2 command-envelope regression coverage
- Semantically ported the first OpenClaw-style lane-queue value into v2 Dexter without adding OpenClaw as a dependency:
  - `src/server/agents/run-ledger.ts`
  - `src/server/agents/outbox.ts`
  - Dexter outbox execution now reserves `tenant_id + lane_key` with a Postgres advisory transaction lock before a run can become `running`
  - sibling runs in the same tenant/resource lane remain queued when another run is already `running` or `waiting_approval`
  - lane-busy attempts append a tenant-bound `agent.wait` command envelope with `lane_busy` metadata and release the outbox event back to pending without posting to Dexter or consuming an attempt
  - focused regression coverage proves the atomic reservation query and worker skip/release behavior

## Rejected Or Deferred Wrong-Folder Work
The wrong-folder tree at `491af65` was not cherry-picked because it would overwrite v2-native systems and replace the tenant model. That tree deletes or supersedes critical v2 paths including native Dexter, server Dexter runtime files, tenant lifecycle/catalog/margin services, backoffice routes, and v2 migration numbering.

Deferred for future semantic port, not lost:
- Better Auth package adoption: rejected for this launch slice because v2 already has tenant-scoped `users`, `auth_sessions`, MFA, session revocation, and privileged-access state. The retained value is the provider-login capability, now implemented as a v2-native Google/Microsoft OAuth adapter. A future OIDC broker can still be added without replacing the v2 session source of truth.
- Tenant ingress/provider webhook adoption for providers beyond WhatsApp: persisted v2-native services, admin routes, and WhatsApp fallback verification are now ported; future provider-specific webhook paths should consume the persisted secret lookup where they support tenant-specific secrets.
- AI safety/control-plane additions: keep the OpenClaw-inspired gateway/control-plane concepts, but do not replace native Dexter or v2 `src/server/dexter-runtime*`.
- Billing provider reconciliation and customer-facing export polish: core lifecycle persistence is now ported; provider payment evidence, invoice PDF/export, and chart/export UI polish remain future deploy/runtime work.
- Wrong-folder migrations `0035` onward: rejected as-is because they conflict with v2 migration numbering and use the wrong tenant assumptions.

## Verification Expectations
Before this recovery branch can replace `main`, run:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- stale coupling scan for legacy adjacent-product terms across `.env.example`, `docs`, `scripts`, `src`, `tests`, and `package.json`

## Current Local Evidence
- Focused recovery tests pass:
  - `tests/external-profile.test.ts`
  - `tests/external-user-links.test.ts`
  - `tests/customer-resolution-reconciliation.test.ts`
  - `tests/tickets-create-external-profile.test.ts`
  - `tests/inbound-tenant-isolation.test.ts`
  - `tests/calls-crm-e2e-script.test.ts`
- Stale coupling scan is clean after the white-label conversion.
- `npm run typecheck` passes after adding the missing script.
- Tenant ingress/provider webhook slice tests pass:
  - `tests/tenant-ingress-secrets.test.ts`
  - `tests/provider-webhook-secrets.test.ts`
  - `tests/admin-tenant-ingress-secrets-api.test.ts`
  - `tests/admin-provider-webhook-secrets-api.test.ts`
  - `tests/whatsapp-provider-webhook-secrets-api.test.ts`
  - `tests/env-validation.test.ts`
- Auth/session/MFA foundation tests pass in the focused slice:
  - `tests/auth-session-hardening.test.ts`
  - `tests/auth-mfa.test.ts`
  - `tests/auth-login-mfa-api.test.ts`
  - `tests/auth-mfa-api.test.ts`
  - `tests/admin-tenant-security-policy-api.test.ts`
  - `tests/auth-sessions-api.test.ts`
  - `tests/password-reset-api.test.ts`
- Auth OAuth login adapter tests pass in the focused slice:
  - `tests/auth-oauth-login-api.test.ts`
  - `tests/env-validation.test.ts`
- Privileged-access grant tests pass in the focused slice:
  - `tests/privileged-access.test.ts`
  - `tests/backoffice-privileged-access-api.test.ts`
  - `tests/backoffice-impersonate-api.test.ts`
  - `tests/security-readiness.test.ts`
- Billing lifecycle persistence tests pass in the focused slice:
  - `tests/billing-lifecycle.test.ts`
  - `tests/admin-workspace-billing-api.test.ts`
  - `tests/backoffice-billing-lifecycle-api.test.ts`
