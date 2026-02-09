# Email Setup (Plug-and-Play)

This guide is designed so you can wire DNS and email routing later without code changes.

## 1) Set Environment Variables (6esk)
Set these in Railway for the 6esk app:

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

## 2) Verify Resend Domain
1. In Resend, add the domain `6ex.co.za`.
2. Copy the SPF and DKIM records Resend provides into Cloudflare DNS.
3. In Resend, click Verify and wait for status to be “Verified”.

## 3) Add DMARC
Add a DMARC TXT record in Cloudflare:

```
Host: _dmarc
Type: TXT
Value: v=DMARC1; p=none; rua=mailto:dmarc@6ex.co.za
```

Adjust policy later to `quarantine` or `reject`.

## 4) Enable Cloudflare Email Routing
1. Enable Email Routing for `6ex.co.za` in Cloudflare.
2. Create a catch‑all rule to forward to the Worker.

## 5) Deploy the Email Worker
From this repo:

```powershell
cd workers/email-forwarder
npm install
npx wrangler deploy
```

Set Worker secrets:

```powershell
npx wrangler secret put INBOUND_URL
npx wrangler secret put INBOUND_SHARED_SECRET
```

Use these values:
- `INBOUND_URL` = `https://<your-6esk-domain>/api/email/inbound`
- `INBOUND_SHARED_SECRET` = the same value as 6esk’s `INBOUND_SHARED_SECRET`

## 6) Validation Commands
DNS checks:

```powershell
Resolve-DnsName 6ex.co.za -Type TXT
Resolve-DnsName _dmarc.6ex.co.za -Type TXT
```

Inbound test without DNS (direct API):

```powershell
$body = @{
  from = "test@example.com"
  to = "support@6ex.co.za"
  subject = "Inbound test"
  text = "Hello from direct inbound test"
  messageId = "<test-message-id-1>"
} | ConvertTo-Json

Invoke-RestMethod -Method POST `
  -Uri "https://<your-6esk-domain>/api/email/inbound" `
  -Headers @{ "x-6esk-secret" = "<INBOUND_SHARED_SECRET>" } `
  -ContentType "application/json" `
  -Body $body
```

Outbound test (Resend):

```powershell
$body = @{
  from = "support@6ex.co.za"
  to = "your.personal@gmail.com"
  subject = "Outbound test"
  text = "Hello from 6esk outbound"
} | ConvertTo-Json

Invoke-RestMethod -Method POST `
  -Uri "https://<your-6esk-domain>/api/email/send" `
  -ContentType "application/json" `
  -Body $body
```

Production inbound test (after DNS + routing):
1. Send an email to `support@6ex.co.za`.
2. Confirm a ticket appears in `/tickets` within 60 seconds.
3. Reply from 6esk and confirm it lands in your inbox.

## 7) Optional Backfill Job (Retries)
Add a scheduled job to retry failed inbound events:

```powershell
npm run retry:inbound
```

Use Railway cron or any scheduler to run every 5–15 minutes.

## 8) Optional Alerts (External Logging)
Set a webhook URL (Slack or similar) in `INBOUND_ALERT_WEBHOOK`, then schedule:

```powershell
npm run alert:inbound
```

Recommended schedule: every 10 minutes.
