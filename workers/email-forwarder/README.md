Cloudflare Email Worker (Inbound Forwarder)

This worker forwards inbound emails from Cloudflare Email Routing to 6esk.

Environment variables
- `INBOUND_URL` -> `https://<app-domain>/api/email/inbound`
- `INBOUND_SHARED_SECRET` -> matches `INBOUND_SHARED_SECRET` in 6esk env

Notes
- Payload matches `docs/email-payload.md` (raw base64 + headers).
- Attachments and body parsing are handled in the 6esk backend later.
