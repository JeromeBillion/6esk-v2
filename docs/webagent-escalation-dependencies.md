# Webchat Escalation Dependencies (3 Repos)

Contract path:
- `prediction-market-mvp` webchat/backend -> `Venus-develop` runtime -> `6esk`

## 1) prediction-market-mvp (`backend/.env`)
- `VENUS_SERVICE_URL`
- `VENUS_AGENT_ID`
- `ELIZA_SERVER_AUTH_TOKEN`
- `SUPPORT_TICKET_API_URL`
- `SUPPORT_TICKET_API_SECRET`
- `SUPPORT_PROFILE_LOOKUP_ENABLED=true`
- `SUPPORT_PROFILE_LOOKUP_SECRET`

Notes:
- `/api/v1/venus` forwards trusted app user metadata (`appUserEmail`, `appUserFullName`, etc.) to Venus.

## 2) Venus-develop (`packages/project-venus/.env`)

Required for webchat escalation bridge:
- `VENUS_ENABLE_ESCALATION_BRIDGE=true`
- `SIXESK_BASE_URL`
- `SIXESK_INBOUND_SECRET`

Required for CRM plugin + outbox/action APIs:
- `VENUS_ENABLE_CRM_AGENT=true`
- `SIXESK_AGENT_KEY`
- `SIXESK_SHARED_SECRET`
- `SIXESK_POLICY_MODE=draft_only|auto_send`

Optional merge policy controls:
- `SIXESK_ALLOW_DIRECT_MERGE_ACTIONS=false|true`
- `SIXESK_MIN_MERGE_CONFIDENCE=0.85`

Cross-service auth:
- `ELIZA_SERVER_AUTH_TOKEN`

## 3) 6esk (`.env`)
- `INBOUND_SHARED_SECRET`
- `AGENT_SECRET_KEY`
- `PREDICTION_PROFILE_LOOKUP_ENABLED=true`
- `PREDICTION_PROFILE_LOOKUP_URL`
- `PREDICTION_PROFILE_LOOKUP_SECRET`
- `AGENT_MERGE_MIN_CONFIDENCE` (default `0.85`)
- `TICKET_MERGE_MAX_MOVE_ROWS` (default `5000`)

## Must-Match Values
- `prediction-market-mvp ELIZA_SERVER_AUTH_TOKEN` = `Venus-develop ELIZA_SERVER_AUTH_TOKEN`
- `Venus-develop SIXESK_INBOUND_SECRET` = `6esk INBOUND_SHARED_SECRET`
- `prediction-market-mvp SUPPORT_PROFILE_LOOKUP_SECRET` = `6esk PREDICTION_PROFILE_LOOKUP_SECRET`
- `prediction-market-mvp SUPPORT_TICKET_API_SECRET` = `6esk INBOUND_SHARED_SECRET`
