# Call Ops Runbook

This runbook covers operational checks, replay validation, outbox retry handling, and rollback steps for 6esk voice calls.

## Required Env

```env
APP_URL=https://<your-6esk-domain>
CALLS_OUTBOX_SECRET=<maintenance-secret>
CALLS_WEBHOOK_SECRET=<webhook-hmac-secret>
CALLS_WEBHOOK_MAX_SKEW_SECONDS=300
CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE=false
CALLS_PROVIDER=mock
```

Notes:
- `CALLS_PROVIDER=mock` is the current supported execution path.
- Keep `CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE=false` outside migration windows.
- Keep consent/retention wording aligned with `docs/privacy-retention-policy.md`.

## Daily Health Checks

1. Call outbox health:
```powershell
Invoke-RestMethod -Method GET -Uri "https://<your-6esk-domain>/api/admin/calls/outbox" -Headers @{ "Cookie" = "<admin_session_cookie>" }
```

2. Failed outbox events:
```powershell
Invoke-RestMethod -Method GET -Uri "https://<your-6esk-domain>/api/admin/calls/failed?limit=50" -Headers @{ "Cookie" = "<admin_session_cookie>" }
```

3. Webhook rejections:
```powershell
Invoke-RestMethod -Method GET -Uri "https://<your-6esk-domain>/api/admin/calls/rejections?hours=24&limit=50" -Headers @{ "Cookie" = "<admin_session_cookie>" }
```

Targets:
- Rejection rate under 2% for 24h.
- Failed outbox queue stable and recoverable with retries.

## Replay-Window Drill

Purpose: validate webhook HMAC + timestamp replay protection.

```powershell
$env:APP_URL="https://<your-6esk-domain>"
$env:CALLS_WEBHOOK_SECRET="<webhook-hmac-secret>"
npm run calls:replay-drill
```

Pass criteria:
- Fresh signed webhook is **not** `401`.
- Replay/stale signed webhook is `401`.

## Outbox Load/Retry Drill

Purpose: exercise outbox trigger and failed-event inspection under repeated runs.

```powershell
$env:APP_URL="https://<your-6esk-domain>"
$env:CALLS_OUTBOX_SECRET="<maintenance-secret>"
$env:CALLS_OUTBOX_DRILL_LOOPS="20"
$env:CALLS_OUTBOX_DRILL_LIMIT="25"
npm run calls:load-drill
```

If failed events remain:
```powershell
Invoke-RestMethod -Method POST -Uri "https://<your-6esk-domain>/api/admin/calls/retry?limit=25" -Headers @{ "x-6esk-secret" = "<maintenance-secret>" }
```

Then re-run:
```powershell
npm run calls:outbox
```

## Incident Triage

1. Identify dominant rejection reason:
- `missing_signature`, `invalid_signature`
- `missing_timestamp`, `invalid_timestamp`, `timestamp_out_of_window`

2. Verify webhook sender:
- Signature format `sha256=<digest>`
- Timestamp header `x-6esk-timestamp`
- Signed payload `${timestamp}.${rawBody}`

3. Verify queue pressure:
- `queued`, `dueNow`, `failed`, `lastError` from `/api/admin/calls/outbox`.

4. Recover:
- Requeue with `/api/admin/calls/retry`.
- Trigger delivery with `/api/admin/calls/outbox`.

## Rollback Actions

When failure thresholds are exceeded:

1. Disable AI voice path:
```env
CALLS_AI_ENABLED=false
```

2. Disable outbound calling:
```env
CALLS_ENABLED=false
```

3. Keep inbound/webhook ingest enabled for forensic continuity.

4. Review `call_webhook_rejected`, `call_outbox_trigger_failed`, and `call_outbox_retry_failed` audit events before re-enabling.
