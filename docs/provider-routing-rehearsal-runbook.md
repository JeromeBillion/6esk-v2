# Provider Routing Rehearsal Runbook

Use this runbook before enabling external tenant traffic for Resend email, WhatsApp, Twilio voice callbacks, managed STT/Deepgram callbacks, or public portal/webchat origins.

## Source Of Truth

Postgres is the source of truth for provider ownership:
- `mailboxes` for inbound email recipient ownership
- `whatsapp_accounts` for Meta WABA and phone ownership
- `call_provider_numbers` for Twilio phone/account ownership
- `tenant_provider_webhook_secrets` for tenant-scoped provider webhook secrets
- `tenant_public_ingress_origins` for public portal/webchat origin ownership

The rehearsal script is read-only. It does not call providers, mutate database rows, or write secrets.

## Evidence Capture

Set a production-like `DATABASE_URL`, then run for the tenant/workspace being prepared:

```bash
npm run rehearse:provider-routing -- --tenant=<tenant-key> --workspace=<workspace-key>
```

This writes a redacted JSON report under `.launch-evidence/provider-routing/`.

The report checks:
- duplicate route keys that would make provider callbacks ambiguous
- missing tenant-scoped Resend webhook secrets for mail-enabled workspaces
- missing tenant-scoped WhatsApp app secrets for active WhatsApp accounts
- missing tenant-scoped Twilio auth tokens for active provider numbers
- missing managed STT HTTP secrets and Deepgram callback tokens for voice-enabled workspaces
- duplicate public portal/webchat origins
- missing active public origin for the scoped tenant/workspace
- whether strict provider-secret mode is enabled for the rehearsal environment

Samples use tenant/workspace scope plus hashed route identifiers. Secrets, signatures, tokens, email addresses, phone numbers, WABA IDs, account SIDs, and origins are not written in plaintext.

## Launch Gate

External provider launch requires:
- `ready=true` in the provider-routing rehearsal evidence
- `TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS=true` or production-equivalent strict mode
- no ambiguous route ownership
- active tenant-scoped provider secrets for every enabled provider path
- an active public origin for public portal/webchat traffic
- a recent signed tenant-ingress drill evidence artifact
- a recent `external_launch` tenant-isolation audit artifact

## Failure Handling

If the rehearsal reports blockers:
- fix ownership records before retrying provider traffic
- rotate missing provider secrets through the lead-admin secret lifecycle APIs
- disable or remove stale provider ownership rows that collide with the target tenant
- keep external provider webhooks paused until the report is clean

If the warning is strict-mode only, rerun with production env or explicitly set:

```bash
TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS=true npm run rehearse:provider-routing -- --tenant=<tenant-key> --workspace=<workspace-key>
```

## Rollback

If provider traffic fails after launch:
- pause the external provider webhook/subscription
- keep tenant-scoped secrets active while investigating, unless compromise is suspected
- if compromise is suspected, rotate the provider secret and rerun the rehearsal
- capture `call_webhook_rejected` and provider-routing evidence before reopening traffic
