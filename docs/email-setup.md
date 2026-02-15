# Email Integration

This file is the current runbook + payload contract for inbound/outbound email in 6esk.

## Required 6esk Env Vars
Set these in your deployment:

```env
APP_URL=https://<your-6esk-domain>
RESEND_API_KEY=<resend_api_key>
RESEND_WEBHOOK_SECRET=<resend_webhook_secret>
RESEND_FROM_DOMAIN=6ex.co.za
SUPPORT_ADDRESS=support@6ex.co.za
INBOUND_SHARED_SECRET=<random_long_secret>
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<r2_access_key>
R2_SECRET_ACCESS_KEY=<r2_secret>
R2_BUCKET=6esk-emails
```

## API Contracts

### `POST /api/email/inbound`
- Auth: header `x-6esk-secret` is required only when `INBOUND_SHARED_SECRET` is set.
- Required body fields:
  - `from`: string
  - `to`: string or string[]
- Optional fields:
  - `cc`, `bcc`: string or string[]
  - `category`: string
  - `tags`: string[]
  - `metadata`: object
  - `subject`, `text`, `html`: string
  - `raw`: base64 RFC822
  - `messageId`, `inReplyTo`: string
  - `references`: string[]
  - `date`: ISO string
  - `attachments[]`: `{ filename, contentType?, size?, contentBase64? }`

Example:
```json
{
  "from": "Customer <customer@example.com>",
  "to": ["support@6ex.co.za"],
  "subject": "Billing issue",
  "text": "Hello, I need help with my invoice.",
  "messageId": "<abc123@example.com>"
}
```

### `POST /api/email/send`
- Auth: requires logged-in session user with non-`viewer` role.
- Also enforces mailbox access for non-admin users.
- Required body fields:
  - `from`: string
  - `to`: string or string[]
  - `subject`: string
- Optional:
  - `cc`, `bcc`, `text`, `html`, `replyTo`
  - `attachments[]`: `{ filename, contentType?, contentBase64 }`

### `POST /api/tickets/create` (platform bridge)
- Auth modes:
  - session user (agent/admin), or
  - `x-6esk-secret` matching `INBOUND_SHARED_SECRET`
- Required:
  - `subject`, `description`
  - external callers should send `from`
- Optional:
  - `to`, `descriptionHtml`, `category`, `tags`, `metadata`, `attachments[]`

## Cloudflare Worker Forwarder
Worker source: `workers/email-forwarder/index.ts`

Current worker behavior:
- Reads inbound raw message
- Forwards to `INBOUND_URL` with:
  - `from`
  - `to[]`
  - `subject`
  - `messageId`
  - `date`
  - `raw` (base64 RFC822)
- Adds `x-6esk-secret` when `INBOUND_SHARED_SECRET` is configured

Required worker secrets:
- `INBOUND_URL=https://<your-6esk-domain>/api/email/inbound`
- `INBOUND_SHARED_SECRET=<same value as 6esk>`

Note: this repo currently includes worker code only. Add your own Wrangler project files (`wrangler.toml`, package manager config) before `wrangler deploy`.

## DNS Setup
1. Verify `6ex.co.za` in Resend (SPF + DKIM).
2. Add DMARC, for example:
   - `Host: _dmarc`
   - `Type: TXT`
   - `Value: v=DMARC1; p=none; rua=mailto:dmarc@6ex.co.za`
3. Enable Cloudflare Email Routing catch-all and route to the worker.

## Validation

Inbound test:
```powershell
$body = @{
  from = "test@example.com"
  to = "support@6ex.co.za"
  subject = "Inbound test"
  text = "Hello"
  messageId = "<test-message-id-1>"
} | ConvertTo-Json

Invoke-RestMethod -Method POST `
  -Uri "https://<your-6esk-domain>/api/email/inbound" `
  -Headers @{ "x-6esk-secret" = "<INBOUND_SHARED_SECRET>" } `
  -ContentType "application/json" `
  -Body $body
```

Outbound test:
- Use the UI while logged in (`/tickets` or `/mail`).
- Or call `POST /api/email/send` with an authenticated session cookie.

## Inbound Maintenance Jobs
- Retry + alert in one runner:
  - `npm run jobs:inbound`
- Alert check only:
  - `npm run alert:inbound`
- Retry endpoint trigger script:
  - `npm run retry:inbound`

Useful env vars:
```env
INBOUND_RETRY_LIMIT=25
INBOUND_ALERT_EVERY_RUN=true
INBOUND_JOB_INTERVAL_SECONDS=0
INBOUND_JOB_MAX_RUNS=1
INBOUND_ALERT_WEBHOOK=
INBOUND_ALERT_THRESHOLD=5
INBOUND_ALERT_WINDOW_MINUTES=30
INBOUND_ALERT_COOLDOWN_MINUTES=60
```
