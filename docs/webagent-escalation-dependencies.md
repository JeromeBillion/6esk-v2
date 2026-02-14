# Webagent Escalation Dependencies (3 Repos)

This is the env + contract map for:  
`prediction-market-mvp webchat` -> `Venus-develop agent` -> `6esk ticket`.

## 1) prediction-market-mvp (backend)

Set in `backend/.env`:

- `VENUS_SERVICE_URL`
- `VENUS_AGENT_ID`
- `ELIZA_SERVER_AUTH_TOKEN` (if Venus API protection is enabled)
- `SUPPORT_TICKET_API_URL` (platform support form relay path)
- `SUPPORT_TICKET_API_SECRET` (must match 6esk `INBOUND_SHARED_SECRET`)
- `SUPPORT_PROFILE_LOOKUP_ENABLED=true`
- `SUPPORT_PROFILE_LOOKUP_SECRET` (must match 6esk `PREDICTION_PROFILE_LOOKUP_SECRET`)

Notes:
- `/api/v1/venus` now resolves auth server-side and forwards trusted user metadata to Venus.

## 2) Venus-develop (project-venus runtime)

Set in `packages/project-venus/.env`:

- `ELIZA_SERVER_AUTH_TOKEN` (must match prediction-market-mvp backend setting)
- `SIXESK_BASE_URL`
- `SIXESK_INBOUND_SECRET` (must match 6esk `INBOUND_SHARED_SECRET`)
- `SIXESK_AGENT_KEY`
- `SIXESK_SHARED_SECRET`
- `SIXESK_POLICY_MODE` (`draft_only` or `auto_send`)

Notes:
- Escalation action now prefers trusted metadata (`appUserEmail`, `appUserFullName`, etc.) over transcript parsing.

## 3) 6esk

Set in `.env`:

- `INBOUND_SHARED_SECRET` (must match Venus `SIXESK_INBOUND_SECRET`)
- `AGENT_SECRET_KEY` (for agent endpoints)
- `PREDICTION_PROFILE_LOOKUP_ENABLED=true`
- `PREDICTION_PROFILE_LOOKUP_URL` (prediction-market-mvp backend base URL)
- `PREDICTION_PROFILE_LOOKUP_SECRET` (must match prediction backend `SUPPORT_PROFILE_LOOKUP_SECRET`)

Notes:
- `POST /api/tickets/create` stores metadata and now enriches `external_profile` when authenticated app user metadata is present.

## Must-Match Values

- `prediction-market-mvp ELIZA_SERVER_AUTH_TOKEN` = `Venus-develop ELIZA_SERVER_AUTH_TOKEN`
- `Venus-develop SIXESK_INBOUND_SECRET` = `6esk INBOUND_SHARED_SECRET`
- `prediction-market-mvp SUPPORT_PROFILE_LOOKUP_SECRET` = `6esk PREDICTION_PROFILE_LOOKUP_SECRET`
- `prediction-market-mvp SUPPORT_TICKET_API_SECRET` = `6esk INBOUND_SHARED_SECRET` (support form relay path)
