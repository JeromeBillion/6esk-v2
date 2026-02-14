# Merge Feature Roadmap (CRM)

Date: 2026-02-14
Scope: 6esk support workspace (`/tickets`) + AI action contract + cross-repo dependencies

## 1) Product Decisions Locked

1. Identity matching for registered users: primary email and/or primary phone number only (from 6ex users source of truth).
2. Unregistered users: show history by contact identity (email and phone).
3. Customer history panel content: tickets and chats context (ticket-level list, with chat/email channel metadata).
4. Hover behavior: when hovering a history ticket row, show the last inbound message sent by that customer on that ticket.
5. Merge model: hard merge (irreversible).
6. Merge permission: all 6esk users except `viewer`.
7. Cross-channel merge constraint: block direct email-ticket <-> WhatsApp-ticket merge. Cross-channel unification happens through customer/profile merge.
8. Customer record creation: create on first contact.
9. If registered user: default outbound recipient should be primary email/phone, but agent can change recipient.
10. If unregistered user: agent must choose recipient.

## 2) Goals

1. Give agents unified customer context in the ticket screen for relationship management.
2. Allow safe irreversible hard merges of duplicate tickets.
3. Allow customer/profile merges (including duplicate registered profiles if needed).
4. Let AI trigger merge actions with policy safeguards and auditability.

## 3) Non-Goals (Phase 1)

1. No unmerge/rollback UI.
2. No automatic merge without explicit actor decision/policy.
3. No direct channel-bridging ticket merge (email ticket into WhatsApp ticket or inverse).

## 4) Data Model Plan

## 4.1 New Tables

1. `customers`
   - `id uuid pk`
   - `kind text not null` (`registered` | `unregistered`)
   - `external_system text null` (ex: `prediction-market-mvp`)
   - `external_user_id text null`
   - `display_name text null`
   - `primary_email text null`
   - `primary_phone text null`
   - `merged_into_customer_id uuid null` (self-ref)
   - `merge_reason text null`
   - `merged_by_user_id uuid null`
   - `merged_at timestamptz null`
   - timestamps
   - unique `(external_system, external_user_id)` when present

2. `customer_identities`
   - `id uuid pk`
   - `customer_id uuid fk customers(id) on delete cascade`
   - `identity_type text not null` (`email` | `phone`)
   - `identity_value text not null` (normalized)
   - `is_primary boolean not null default false`
   - `source text not null` (`inbound_email`, `inbound_whatsapp`, `profile_lookup`, `manual_merge`)
   - timestamps
   - unique `(identity_type, identity_value)` for active canonical mapping

3. `ticket_merges`
   - immutable operation log
   - `id uuid pk`
   - `source_ticket_id uuid not null`
   - `target_ticket_id uuid not null`
   - `source_channel text not null`
   - `target_channel text not null`
   - `reason text null`
   - `actor_user_id uuid not null`
   - `created_at timestamptz not null`
   - optional `summary jsonb` (moved row counts)

4. `customer_merges`
   - immutable operation log
   - `id uuid pk`
   - `source_customer_id uuid not null`
   - `target_customer_id uuid not null`
   - `reason text null`
   - `actor_user_id uuid not null`
   - `created_at timestamptz not null`

## 4.2 Tickets Table Extensions

1. Add `customer_id uuid null references customers(id)`.
2. Add merge markers:
   - `merged_into_ticket_id uuid null references tickets(id)`
   - `merged_by_user_id uuid null references users(id)`
   - `merged_at timestamptz null`
3. Add partial index for active tickets:
   - `where merged_into_ticket_id is null`

## 4.3 Backfill Strategy

1. Backfill `customers` from existing `tickets` + `external_user_links` + `tickets.metadata.external_profile`.
2. Backfill `tickets.customer_id`.
3. Add reconciliation script for unmapped legacy rows.

## 5) Identity Resolution Rules

## 5.1 Registered

1. Resolve from profile lookup match restricted to primary email/primary phone only.
2. Create/find `customers.kind = registered` using `(external_system, external_user_id)`.
3. Set `primary_email` and `primary_phone` from trusted profile source.

## 5.2 Unregistered

1. If no registered match, resolve by normalized inbound email/phone identity.
2. Create `customers.kind = unregistered` on first contact.
3. Attach incoming identity into `customer_identities`.

## 5.3 Conflict Rules

1. If identity already belongs to another customer, do not auto-steal identity.
2. Raise merge candidate signal for agent/AI review.

## 6) Customer History Panel (Right Side)

## 6.1 UX Placement

1. Desktop: convert support detail area into 2-column sublayout:
   - left: current conversation/composer
   - right: `Customer History` panel
2. Mobile/tablet: panel becomes collapsible drawer under ticket header.

## 6.2 Panel Data

For active ticket customer, list related tickets ordered by latest message timestamp desc:

1. Ticket id
2. Channel badge (`Email` / `WhatsApp`)
3. Subject
4. Requester label
5. Status + priority
6. Last message at
7. Last customer inbound preview (for hover)
8. Quick action: `Open ticket`

## 6.3 Hover Behavior

1. Hovering a history row reveals a compact preview card:
   - "Last message from customer"
   - timestamp
   - truncated preview body
2. Preview source query: latest `messages.direction='inbound'` for that ticket where sender identity matches current customer identities.

## 6.4 API

1. `GET /api/tickets/{ticketId}/customer-history`
   - resolve current ticket -> customer -> related tickets
   - returns ordered list latest-to-oldest
2. Include pagination (`cursor`, `limit`) for large histories.

## 7) Hard Ticket Merge (Irreversible)

## 7.1 Rules

1. Only non-viewer roles can merge.
2. Source and target must be different.
3. Source and target must not already be merged.
4. Block cross-channel merge:
   - if source ticket effective channel != target ticket effective channel -> reject with:
   - `Cross-channel ticket merge is disabled. Merge customer profiles instead.`

## 7.2 Operation (transactional)

1. Lock source + target tickets (`FOR UPDATE`).
2. Move children from source -> target:
   - `messages.ticket_id`
   - `ticket_events.ticket_id` (append merge event metadata)
   - `replies.ticket_id`
   - `agent_drafts.ticket_id`
   - `ticket_tags` dedupe to target
3. Recompute target metadata:
   - preserve target subject/status/assignee
   - add `metadata.mergedFrom[]`
4. Mark source ticket:
   - `merged_into_ticket_id = target`
   - `merged_at`, `merged_by_user_id`
   - set status `closed` (or dedicated merged behavior in UI)
5. Write `ticket_merges` + `audit_logs` + `ticket_events`.

## 7.3 UI

1. Add `Merge` button in ticket header action cluster.
2. Merge modal:
   - search by ticket id, requester email/phone, subject
   - candidate list with channel/status/updated time
   - mandatory target selection and confirmation text
   - preflight summary (messages/events/drafts/tags counts to move)

## 8) Customer/Profile Merge

## 8.1 Purpose

1. Unify duplicate customer profiles.
2. Enable cross-channel visibility without cross-channel ticket merge.

## 8.2 Operation

1. Lock source + target customers.
2. Move all `tickets.customer_id` from source -> target.
3. Move identities from source -> target with dedupe.
4. Source customer marked merged (`merged_into_customer_id` + metadata).
5. Log in `customer_merges` + `audit_logs`.

## 8.3 Cross-Channel Outcome

1. After customer merge, history panel can show both email and WhatsApp tickets for the canonical customer.
2. Each ticket remains in its native channel thread.

## 9) Composer Recipient Logic

1. Registered identified customer:
   - default recipient = primary email/phone
   - agent can switch recipient
2. Unregistered customer:
   - require explicit recipient selection by agent
3. Persist chosen recipient in outbound message metadata for auditability.

## 10) Agent Integration (AI Merge Actions)

## 10.1 6esk API Contract Changes

Extend `/api/agent/v1/actions` with:

1. `merge_tickets`
   - fields:
   - `sourceTicketId`, `targetTicketId`, `reason`, `confidence`, `metadata`
   - applies same validations as UI merge

2. `merge_customers`
   - fields:
   - `sourceCustomerId`, `targetCustomerId`, `reason`, `confidence`, `metadata`

3. `propose_merge` (optional safer mode)
   - AI suggests candidate merge; action stored as review task for human approval.

## 10.2 Policy and Safety

1. Gate merge actions behind integration capability flag:
   - `capabilities.allowMergeActions = true`
2. Default behavior for AI should be `propose_merge` unless explicitly enabled for direct merge.
3. All AI merges require:
   - confidence threshold
   - explicit reason
   - full audit record

## 10.3 Agent Event Extensions

Emit new events:

1. `ticket.merged`
2. `customer.merged`
3. `customer.identity.resolved`
4. `merge.review.required` (if using propose/approve flow)

## 10.4 Agent Repo Updates Needed (Venus-develop / project-venus)

1. Update action schema/client to send new action types (`merge_tickets`, `merge_customers`, optionally `propose_merge`).
2. Add merge candidate detection logic from context:
   - same customer identifiers
   - duplicate issue semantics
   - recent parallel escalations
3. Add merge-preflight fetches:
   - customer history endpoint
   - ticket search endpoint
   - customer search endpoint
4. Add policy controls:
   - default `propose_merge`
   - optional direct merge if capability enabled
5. Handle new events in event consumer and memory/state layer.
6. Update prompts/playbooks:
   - never merge across channels at ticket level
   - use customer merge for cross-channel unification

## 11) API Endpoints (Planned)

1. `GET /api/tickets/{ticketId}/customer-history`
2. `GET /api/customers/search?q=...`
3. `GET /api/tickets/search?q=...`
4. `POST /api/tickets/merge`
5. `POST /api/customers/merge`
6. `POST /api/agent/v1/actions` (extended merge actions)

## 12) Rollout Phases

## Phase A: Foundations

1. DB migrations (`customers`, `customer_identities`, merge markers/log tables).
2. Resolver library + backfill scripts.
3. Inbound write-path updates for `customer_id`.

## Phase B: History Panel

1. Customer history query service + endpoint.
2. Right-side panel UI + hover preview.
3. Performance tuning and indexes.

## Phase C: Ticket Merge

1. Merge preflight endpoint.
2. Merge execution endpoint (transactional).
3. Merge modal UI + audit timeline visibility.

## Phase D: Customer Merge

1. Customer search + merge endpoint.
2. Profile merge UI.
3. Cross-channel history validation.

## Phase E: AI Merge Enablement

1. Action schema updates + capability gates.
2. New merge events.
3. Agent repo rollout and end-to-end tests.

## 13) Acceptance Criteria

1. Active ticket shows right-side history for same customer sorted latest->oldest.
2. Hovering history row displays last customer inbound preview on that ticket.
3. Ticket merge moves thread artifacts into one target ticket and source becomes merged/locked.
4. Cross-channel ticket merge is blocked with explicit message.
5. Customer merge unifies profile and reveals both channel histories for canonical customer.
6. Viewer cannot merge; other support users can.
7. AI merge actions are auditable and policy-gated.

## 14) Risks and Mitigations

1. Wrong merges:
   - require preflight summary + confirmation + audit.
2. Large transactional merges:
   - row-count caps, indexing, retry-safe transactional boundaries.
3. Identity drift/conflicts:
   - canonical customer model + conflict detection + manual review path.
4. AI unsafe merges:
   - default propose-only mode and capability flag for direct execution.

