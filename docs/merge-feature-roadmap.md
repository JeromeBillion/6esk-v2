# CRM Merge and Customer History

This file is the compact, code-aligned spec for customer identity, customer history, and merge behavior.

## Current Scope
- Customer model for registered/unregistered identities
- Customer history panel and API with pagination
- Irreversible ticket merge (same-channel only)
- Irreversible customer merge
- AI merge actions (`propose_merge`, `merge_tickets`, `merge_customers`)
- Merge review queue for human approval flow

## Data Model (Implemented)
Primary migrations:
- `db/migrations/0017_customer_merge_foundations.sql`
- `db/migrations/0018_merge_review_tasks.sql`
- `db/migrations/0019_message_metadata.sql`

Core tables:
- `customers`
- `customer_identities` (global unique identity mapping)
- `ticket_merges`
- `customer_merges`
- `merge_review_tasks`

Ticket extensions:
- `tickets.customer_id`
- `tickets.merged_into_ticket_id`
- `tickets.merged_by_user_id`
- `tickets.merged_at`

## Merge Rules

### Ticket Merge
- Source and target must be different
- Source/target must exist and be active (not already merged)
- Cross-channel direct merge is blocked (`email` vs `whatsapp`)
- Merge row movement is capped by `TICKET_MERGE_MAX_MOVE_ROWS` (default `5000`)
- Source ticket is marked merged into target and closed
- Target metadata gets provenance in `metadata.mergedFrom[]`

### Customer Merge
- Source and target customers must be different
- Source/target must exist and not already be merged
- Moves ticket ownership and deduplicates identities

### Permissions
- UI/API merges require authenticated non-`viewer` users
- Non-admin users are constrained by ticket assignment rules

## Customer History
Endpoint:
- `GET /api/tickets/{ticketId}/customer-history?limit=&cursor=`

Behavior:
- Resolves/attaches customer identity when missing
- Returns `history[]` ordered newest-first
- Returns `nextCursor` for pagination
- Includes channel (`email`/`whatsapp`) and latest inbound preview

## Merge APIs
- `POST /api/tickets/merge/preflight`
- `POST /api/tickets/merge`
- `POST /api/customers/merge/preflight`
- `POST /api/customers/merge`

Execution endpoints require irreversible acknowledgement text:
- value must match `MERGE_IRREVERSIBLE_ACK_TEXT`

## Search APIs Used by Merge UI
- `GET /api/tickets/search?q=&limit=`
- `GET /api/customers/search?q=&limit=`

## Agent Contract (`/api/agent/v1/actions`)
Supported merge action types:
- `propose_merge`
- `merge_tickets`
- `merge_customers`

Safety requirements:
- explicit `reason` required
- `confidence` required
- confidence must satisfy `AGENT_MERGE_MIN_CONFIDENCE` (default `0.85`)
- direct merge actions require integration capability `allowMergeActions=true`

Agent merge-related events:
- `ticket.merged`
- `customer.merged`
- `customer.identity.resolved`
- `merge.review.required`

## Operations
Run migrations:

```powershell
npm run db:migrate
```

Backfill/reconcile existing tickets to customers:

```powershell
npm run jobs:customer-backfill
```
