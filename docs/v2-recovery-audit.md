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

## Rejected Or Deferred Wrong-Folder Work
The wrong-folder tree at `491af65` was not cherry-picked because it would overwrite v2-native systems and replace the tenant model. That tree deletes or supersedes critical v2 paths including native Dexter, server Dexter runtime files, tenant lifecycle/catalog/margin services, backoffice routes, and v2 migration numbering.

Deferred for future semantic port, not lost:
- Better Auth/MFA/privileged-access additions: keep the idea, but port only against v2 auth/session and tenant-id contracts.
- Tenant ingress/provider webhook adoption for providers beyond WhatsApp: persisted v2-native services, admin routes, and WhatsApp fallback verification are now ported; future provider-specific webhook paths should consume the persisted secret lookup where they support tenant-specific secrets.
- AI safety/control-plane additions: keep the OpenClaw-inspired gateway/control-plane concepts, but do not replace native Dexter or v2 `src/server/dexter-runtime*`.
- Billing lifecycle modules: keep subscription/proration/credits/dunning/invoice lifecycle requirements, but merge against v2 pricing, margin, tenant lifecycle, and migration sequence.
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
