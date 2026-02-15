Cloudflare Email Worker (Inbound Forwarder)

This worker forwards inbound emails from Cloudflare Email Routing to 6esk.

Environment variables
- `INBOUND_URL` -> `https://<app-domain>/api/email/inbound`
- `INBOUND_SHARED_SECRET` -> matches `INBOUND_SHARED_SECRET` in 6esk env

Notes
- Payload contract is documented in `docs/email-setup.md`.
- Attachments and body parsing are handled in the 6esk backend later.
