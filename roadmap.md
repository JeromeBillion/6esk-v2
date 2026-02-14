6esk MVP Roadmap

**Product Summary**
6esk is a lightweight helpdesk with a built‑in, two‑way email system. The MVP is a fast, analytics‑first support platform for a single org (6ex Support), with email as the primary channel and a clean operator workflow for tickets and personal mail. 6esk also exposes AI‑ready integration points so an external ElizaOS agent can draft replies without embedding AI logic in this repo.

**Non‑Negotiables**
- Two‑way email is core and top priority (inbound + outbound + storage).
- Auth is required. No signup. Lead Admin creates accounts and roles in an admin panel.
- Mailboxes: platform mailbox `support@6ex.co.za` for CRM tickets.
- Mailboxes: personal mailbox `name@6ex.co.za` for direct partner/vendor/investor/staff email.
- All org addresses must be provisionable inside 6esk, no manual mailbox creation.
- WhatsApp Business chat must be supported for inbound and outbound support.

**Scope Definition (MVP)**
- Ticketing: email + web form + WhatsApp inbound, ticket lifecycle, assignment, replies.
- Analytics: core dashboard + SLA‑lite metrics.
- Admin: user creation, role assignment, mailbox access controls.
- Single org: no multi‑tenant organizations.

**Key Decisions**
- Hosting: start on Railway for speed; revisit cost optimization after MVP.
- Backend: Node.js + REST API.
- Frontend: Next.js (app router) for speed and single deployment.
- Database: Postgres.
- Email outbound: Resend API.
- Email inbound: Cloudflare Email Routing + Worker (catch‑all) -> backend webhook.
- Storage: Cloudflare R2 for raw emails and attachments.
- Auth: email/password, server‑side sessions (HTTP‑only cookies).
- AI integration: external ElizaOS runtime via signed webhooks; 6esk remains system of record.

**Architecture Overview**
- Inbound flow: Cloudflare Email Routing -> Worker -> `/api/email/inbound` -> Postgres + R2.
- Outbound flow: UI -> `/api/email/send` -> Resend -> store copy in Postgres + R2.
- Ticket linkage: `support@6ex.co.za` inbound automatically creates tickets.
- Personal mailbox: `name@6ex.co.za` inbound lands in personal mailbox, not tickets.
- Address provisioning: catch‑all routing + internal user table controls visibility and access.
- AI agent flow: transactional outbox emits ticket/email events -> delivery worker -> ElizaOS webhook -> agent fetches context via scoped APIs -> agent posts back actions (draft reply, tags, priority).
- WhatsApp flow: WhatsApp Business Platform (Cloud API or provider) -> webhook -> `/api/whatsapp/inbound` -> Postgres -> UI; outbound via `/api/whatsapp/send`.

**Performance Reports (MVP Spec)**
These are the “performance reports” referenced in the PRD.
- Agent workload: tickets assigned, open, solved, and backlog by agent.
- Responsiveness: avg first response time, avg resolution time by agent and by tag.
- SLA‑lite: % meeting first response target, % meeting resolution target, breaches.
- Volume trends: created vs solved over time, and delta (backlog growth).
- Quality proxy: reopen rate and CSAT (if enabled).
- Report scope: global, by date range, by agent, by tag, by priority.

**Roadmap Phases**

**Progress Update (2026-02-14)**
- Phase 0 complete: repo, schema, migrations, R2 wiring, env setup.
- Phase 1 dev-ready, awaiting DNS verification.
- Phase 2 complete: auth + admin panel + seed + audit logs + password resets.
- Phase 3 complete: mailbox UI + message list.
 - Mailbox message detail + reply/forward composer added.
 - Mailbox threading by `thread_id` with collapsible threads added.
- UI shell + routing baseline started (sidebar/header, `/` -> `/tickets`, unified nav).
- Mail tab now opens personal inbox by default (no mailbox selector).
- Admin panel reorganized into section list with single-panel focus.
- Mail enhancements: folder sidebar, compose actions, search/filters, pin/star flags, attachments.
- Mail compose now supports HTML mode with preview and text fallback.
- Admin WhatsApp settings UX improved (status warnings, copy helpers, template param counts).
- Admin WhatsApp outbox queue metrics + refresh controls added.
- Analytics now includes channel mix + WhatsApp delivery health metrics.
- Analytics now includes daily WhatsApp status trend (sent/delivered/read/failed).
- WhatsApp analytics trend now includes compact chart UI plus source/status filters.
- Tickets UI cleanup: structured layout, empty states, keyboard shortcuts, quick actions.
- Tickets bulk actions added (status/priority/assign) plus quick reply template chips.
- Tickets bulk tags (add/remove) and quick close/snooze actions added.
- Ticket list density toggle + shift-click range selection added.
- WhatsApp thread view now includes date dividers and contact quick actions.
- Ticket detail tag editor (add/remove + suggestions) added.
- Admin polish: section counts, user search, role badges.
- AI workflow polish: ticket-level audit trail surfaced alongside drafts.
- AI agent default policy now uses 24/7 working hours (editable in admin).
- Support filters now include channel chips (All / Email / WhatsApp).
- Support ticket list now displays a channel badge per ticket.
- AI drafts review queue added (filters + bulk approve/dismiss).
- AI outbox controls added in Admin (max events/run cap, queue metrics, manual deliver).
- WhatsApp attachments supported (inbound/outbound + thread preview incl. audio/video).
- Support quick filters + saved views added.
- Sidebar renamed from “Platform” to “Support.”
- Phase 4 complete: ticket core + platform web form UI + tag management.
- Phase 6 in progress: AI agent integration plumbing (registry, outbox, context/actions APIs, draft UI).
- Phase 7 in progress: retries/backfill, spam handling, rate limiting, alerting.
- Phase 8 in progress: WhatsApp scaffolding (schema, inbound/outbound endpoints, admin config UI).
- Phase 9 in progress: cross-repo profile enrichment from `prediction-market-mvp` users table.
- `prediction-market-mvp` internal profile lookup API added (`/api/v1/internal/support/users/lookup`) with shared-secret auth.
- 6esk inbound email + WhatsApp now perform profile lookup and persist profile enrichment metadata on tickets.
- Support ticket detail now displays recognized external user profile context.
- Added persistent `external_user_links` mapping table in 6esk for stable external user identity linkage and last-seen tracking.
- Phase 10 in progress: CRM merge foundations shipped (customer model, customer history panel, merge APIs) and merge preflight impact summaries added in Support UI.
- Phase 10 AI/event extension in progress: outbox events now include `ticket.merged`, `customer.merged`, and `customer.identity.resolved` for agent-side merge awareness.
- Customer history API now supports cursor pagination (`nextCursor`) and Support UI can load older history progressively.
- Added `merge.review.required` workflow: persisted `merge_review_tasks`, agent `propose_merge` now creates review tasks, and Support now includes a Merge Review Queue with approve/reject actions.
- Analytics overview now includes merge counters (ticket/customer volume, AI vs human actor split, review queue/failure summary, top failure reasons).
- Added customer reconciliation job script for legacy `tickets.customer_id` backfill (`npm run jobs:customer-backfill`, dry-run by default).
- Support composer recipient logic now honors customer identity rules: registered users default to primary contact with agent override, unregistered/unknown users require explicit recipient selection, and outbound messages persist recipient metadata.
- AI merge actions now enforce explicit reason + minimum confidence threshold (default `0.85`, configurable via `AGENT_MERGE_MIN_CONFIDENCE`) across `propose_merge`, `merge_tickets`, and `merge_customers`.
- Ticket merge now appends provenance in target `tickets.metadata.mergedFrom[]` (source ticket/channel, reason, timestamp, moved row counts).
- Ticket merge preflight/execution now enforce a configurable row-move safety cap (`TICKET_MERGE_MAX_MOVE_ROWS`, default `5000`) to guard against oversized merge operations.
- Added API-level tests for ticket merge execution blocking paths (`cross_channel_not_allowed`, `too_large`) and success response contract.
- Added API-level preflight tests for ticket merge blocking states (`cross_channel_not_allowed`, `too_large`) and merge error status mapping.
- Added customer merge API and preflight contract tests (blocking codes/status mapping + success payloads) to mirror ticket-merge coverage depth.
- Merge execution APIs now require explicit irreversible acknowledgment text (server-side validation), with Support UI passing the same acknowledgment string in submit payloads.
- Expanded merge endpoint contract tests for auth/permissions (unauthorized, viewer-forbidden, and ticket assignment guardrails for non-admin users).
- Admin now includes a Profile Lookup diagnostics panel backed by `/api/admin/profile-lookup/metrics` (hit/miss/error/timeout rates + avg/p95 latency trend over selectable windows).
- Profile lookup metadata now stores `durationMs` for matched/missed/error/disabled outcomes, enabling real latency reporting in admin diagnostics.
- Profile lookup now uses `external_user_links` as a warm-cache fallback for live miss/timeout paths, with matched metadata source tagged as `prediction-market-mvp-cache`.
- Profile lookup diagnostics now segment matched outcomes by live vs cache source and report cache fallback hit rate.
- AI `send_reply` now enforces out-of-hours escalation policy: outside working hours can auto-create draft reviews and apply configured escalation tags instead of sending.

**Roadmap Status (as of 2026-02-14)**
| Phase | Status |
| --- | --- |
| 0 Foundation | Complete |
| 1 Email (DNS) | Dev-ready, awaiting DNS verification |
| 2 Tickets & Replies | Complete |
| 3 Threading | Complete |
| 4 Tags/Macros | Complete |
| 5 Analytics | Complete |
| 6 AI Agent | In progress |
| 7 Hardening | In progress |
| 8 WhatsApp | In progress |
| 9 Cross-Repo Profile Enrichment | In progress |
| 10 CRM Merge + Customer History | In progress |

**Phase 0 — Repo & Foundations**
Deliverables
- Project skeleton (Next.js + API routes or separate API service).
- Postgres schema for users, roles, tickets, replies, mailboxes, messages, attachments.
- R2 bucket setup and SDK wiring.
- Environment/config management with Railway variables.
Acceptance Criteria
- App boots locally and on Railway.
- DB migrations run cleanly.
- R2 read/write verified with a test object.

**Phase 1 — Email Infrastructure (Priority 0)**
Deliverables
- Resend domain verified with SPF/DKIM.
- Cloudflare Email Routing enabled for `6ex.co.za` catch‑all.
- Worker parses inbound MIME and forwards to `/api/email/inbound`.
- Inbound handler stores raw email + attachments in R2 and metadata in Postgres.
- Outbound handler sends via Resend and stores a sent copy in R2/Postgres.
Status
- API handlers complete.
- Cloudflare worker stub complete.
- Dev-ready, awaiting DNS + Resend verification.
Acceptance Criteria
- Email to `support@6ex.co.za` appears in database within 60 seconds.
- Email to `jerome.choma@6ex.co.za` appears in personal mailbox.
- Reply from 6esk delivers to Gmail/Outlook inbox (not spam).
- Attachments render and download correctly.

**Phase 2 — Auth + Admin Panel**
Deliverables
- Sign‑in with email/password.
- Lead Admin role can create users, set roles, and assign mailbox access.
- User list, role list, and basic audit log (create user, role change).
- Password reset for admin‑created users.
Acceptance Criteria
- Only admin can create users.
- Users can sign in and see authorized mailboxes only.

**Phase 3 — Mailbox UI (Personal + Platform)**
Deliverables
- Unified mailbox UI with filters for Platform vs Personal.
- Message list + detail view.
- Reply/forward actions.
- Threading by `Message‑ID` and `In‑Reply‑To` headers where available.
Acceptance Criteria
- Support mailbox reads/writes work end‑to‑end.
- Personal mailbox reads/writes work end‑to‑end.

**Phase 4 — Ticketing Core**
Deliverables
- Ticket creation from platform mailbox inbound.
- Ticket statuses: New, Open, Pending, Solved, Closed.
- Manual assignment and notes.
- Web form ticket creation.
Status
- Ticket creation from inbound done.
- Ticket replies via Resend done.
 - Ticket create API for platform done.
 - Internal web form UI added (`/tickets/new`).
 - Message detail and attachment downloads added.
 - Server-side ticket search + filters added.
 - Ticket activity timeline added.
 - Attachment previews (image/PDF) added.
 - Lead Admin tag creation UI added.
- Platform web form UI added (`/support`).
- Tag edit/delete flow added.
Acceptance Criteria
- Incoming email to `support@6ex.co.za` creates a ticket with requester email.
- Agent replies from ticket are sent via Resend and logged.

**Phase 5 — Analytics & Reports**
Deliverables
- Dashboard metrics (global and per‑agent).
- Volume charts and SLA‑lite analytics.
- Performance reports section (spec above).
Status
- Analytics API scaffolding added (overview, volume, SLA).
- Initial analytics UI added (`/analytics`).
- Performance reports added (agent, tag, priority).
- Date range selector added.
- SLA admin controls added.
 - Analytics filters and CSV export added.
 - Channel mix and WhatsApp delivery health summary added in analytics overview.
 - WhatsApp status trend added in analytics volume report.
 - WhatsApp status trend source filter (all/webhook/outbox) and status toggles added.
Acceptance Criteria
- Metrics match definitions in PRD for any date range.
- Reports can be filtered by agent, tag, priority.

**Phase 6 — AI Agent Integration (ElizaOS)**
Deliverables
- Agent registry (AgentIntegration) with provider, base URL, auth type, shared secret, scopes, policy tier.
- Event outbox + delivery worker with retries and pause.
- Signed webhook delivery (HMAC + timestamp).
- Agent context APIs (`/agent/v1/tickets`, `/agent/v1/messages`, `/agent/v1/threads`).
- Agent actions API (`/agent/v1/actions`) for draft_reply, tags, priority, assignment.
- UI to onboard agent and configure scopes, tiers, working hours.
- Draft panel in ticket UI with insert/edit/send workflow.
- Audit log for all AI actions; message origin `human | ai`.
Status
- Agent registry + admin UI added.
- Outbox + delivery endpoint added.
- Agent context APIs added.
- Actions API added (drafts + auto-send gate).
- Draft panel added in tickets UI.
- Draft accept/dismiss actions added.
- Draft approve/send actions added.
- Draft edit + approve/send flow completed.
- Working hours + escalation policy config added (JSON policy).
- Audit log UI added in Admin panel.
- Agent outbox queue controls added (throughput cap + queue metrics + manual deliver trigger).
Acceptance Criteria
- Agent receives `ticket.message.created` events within 60 seconds.
- Agent can fetch context via scoped APIs and post a draft reply.
- Drafts are visible to agents and must be manually sent unless tier allows auto-send.

**Phase 7 — Hardening & QA**
Deliverables
- Inbound retry and idempotency keys for email ingestion.
- Backfill jobs to reprocess failed inbound payloads.
- Basic spam handling (manual flagging, whitelist/blacklist).
- Security pass (RBAC, rate limiting, audit log coverage).
Status
- Inbound idempotency tracking + retry endpoint added.
- Spam rules + manual spam flagging added.
- Rate limiting middleware added for admin/agent endpoints.
- Auth/login, portal, ticket create, and outbound email endpoints rate-limited.
- Backfill retry script added (`npm run retry:inbound`).
- Admin spam review + inbound failure monitoring added.
- Inbound failure alerting (webhook + cron script) added.
- Inbound maintenance job runner added (`npm run jobs:inbound`) with cron and loop modes.
- Admin inbound metrics API + trend panel added (queue health + 24h processing/failure view).
- WhatsApp inbound webhook now supports Meta signature verification (`x-hub-signature-256`) when `WHATSAPP_APP_SECRET` is set.
- Agent shared secrets encrypted at rest when `AGENT_SECRET_KEY` is set.
- Optional IP allowlists for admin/agent endpoints added.
- Rate limits expanded to ticket replies/draft sends and WhatsApp send/resend/inbound routes (env-configurable).
- Inbound alert settings are now configurable in Admin (webhook, threshold, window, cooldown) with env fallback.
- Viewer role restricted from ticket mutations + outbound send; SLA/tag changes now audited.
- Admin security panel shows encryption status + IP allowlist configuration guidance.
Acceptance Criteria
- System handles duplicate inbound webhook safely.
- Failures are recoverable without data loss.

**Phase 8 — WhatsApp Channel (New Requirement)**
Deliverables
- WhatsApp Business account connection (Cloud API or provider).
- Inbound webhook to receive messages and delivery/read statuses.
- Outbound WhatsApp send with template enforcement for out-of-window messages.
- Ticket linkage and threading for WhatsApp conversations.
- UI to view and reply to WhatsApp threads inside 6esk.
- Admin UI to configure WhatsApp credentials, number, templates, and status.
- Audit log coverage for WhatsApp sends and configuration changes.
- AI parity: WhatsApp messages flow through the agent outbox + context APIs, and AI drafts/auto-send honor WhatsApp policy gates.
Acceptance Criteria
- Inbound WhatsApp message creates/updates a ticket within 60 seconds.
- Replies from 6esk are delivered to WhatsApp and stored in the thread.
- Messages outside the 24h window use approved templates.
- Status updates (sent/delivered/read) are captured.
- When AI integration is enabled, WhatsApp threads appear in agent context and AI drafts/auto-send follow policy + template rules.
Status
- Schema additions for WhatsApp channel and event queue added.
- Admin UI to configure WhatsApp credentials + status added.
- Inbound webhook now ingests WhatsApp payloads and creates tickets/messages.
- Ticket replies route WhatsApp responses through the outbound queue.
- Ticket UI shows WhatsApp channel badges + delivery status.
- 24h window enforcement added with template-required flow in Support UI.
- WhatsApp outbox processor added with retry/backoff + admin trigger script.
- WhatsApp admin outbox metrics (queued/due/failed/sent) added for operations visibility.
- WhatsApp bubble view added to Support ticket conversations.
- WhatsApp template registry (admin) + Support template picker added.
- WhatsApp template parameter validation + status timeline added.
- WhatsApp payload preview + status history log + auto-refresh polling added.
- WhatsApp bubble status iconography (queued/sent/delivered/read/failed) added.
- WhatsApp template parameter preview chips added in Support reply panel.
- WhatsApp resend flow added for failed outbound messages (API + UI action).
- AI actions now accept WhatsApp templates; template-only replies supported for WhatsApp.
- AI drafts can carry WhatsApp template metadata and send with template on approval.
- Support message detail now includes WhatsApp status drill-down (source, latency hops, payload/error details).

**Phase 9 — Cross-Repo Profile Enrichment (prediction-market-mvp)**
Goal
- Auto-detect and auto-fill customer profile data in 6esk when inbound email/WhatsApp matches a known `prediction-market-mvp` user.

Scope
- Enrich inbound email and inbound WhatsApp ticket creation flows with profile lookup.
- Store a profile snapshot on ticket/message metadata plus a stable external link for future matches.
- Surface profile pill/card in Support ticket detail (name, user id, KYC/account status, matched email/phone).

Integration Strategy (recommended)
- Use server-to-server API lookup from 6esk to `prediction-market-mvp` (not direct DB credentials from 6esk).
- Keep 6esk as consumer-only for external identity; `prediction-market-mvp` remains source of truth.

6esk Implementation Plan
1. Add profile lookup client in 6esk (`src/server/integrations/prediction-profile.ts`) with timeout/retry and circuit-breaker fallback.
2. Normalize inbound identifiers before lookup:
   - Email: lowercase/trim, match against primary + secondary email.
   - WhatsApp phone: normalize to SA local + E.164-compatible variants for matching.
3. Enrich inbound handlers:
   - Email path: `src/server/email/inbound-store.ts`
   - WhatsApp path: `src/server/whatsapp/inbound-store.ts`
4. Persist mapping:
   - Add `external_user_links` table (external_system, external_user_id, email, phone, matched_by, confidence, last_seen_at).
   - Add profile snapshot into `tickets.metadata.externalProfile` and `messages.ai_meta`/metadata where appropriate.
5. UI update:
   - Ticket detail in `src/app/tickets/TicketsClient.tsx` shows external profile panel with verification timestamp and statuses.
6. Observability:
   - Add counters in analytics/admin for lookup hit rate, miss rate, lookup latency, and lookup failures.
7. Safe fallback:
   - If lookup fails/timeouts, ticket creation continues normally with no blocker.

Acceptance Criteria
- Inbound email from known user auto-populates profile context in the created/updated ticket.
- Inbound WhatsApp from known number auto-populates profile context in the created/updated ticket.
- Lookup failures do not block inbound ingestion.
- Audit/event trail records enrichment status (`matched`, `missed`, `lookup_error`).

Explicit Dependencies Required From `C:\\Users\\choma\\Desktop\\prediction-market-mvp`
1. User data source and fields:
   - `backend/src/db/schema.ts` `users` columns required for lookup/enrichment:
   - `id`, `email`, `secondary_email`, `full_name`, `phone_number`, `kyc_status`, `account_status`, `created_at`, `updated_at`.
   - Optional closure fields for historical context: `closed_email_primary`, `closed_email_secondary`, `closed_at`.
2. Phone/email normalization rules:
   - `backend/src/api/validation/primitives.ts` (`safePhoneNumber`, `safeEmail`).
   - `backend/src/api/validation/normalize.ts` (`normalizePhoneNumber`, text normalization).
3. Existing integration auth pattern to reuse:
   - `backend/src/utils/supportTickets.ts` (`x-6esk-secret`, `SUPPORT_TICKET_API_SECRET`) as the baseline for shared-secret auth style.
4. New internal lookup endpoint to add in `prediction-market-mvp`:
   - New route file: `backend/src/api/routes/internalSupport.ts` (to be created there).
   - Route registration in: `backend/src/api.ts`.
   - Proposed endpoint contract:
     - `GET /api/v1/internal/support/users/lookup?email=...&phone=...`
     - Header: `x-6esk-secret: <SUPPORT_PROFILE_LOOKUP_SECRET>`
     - Response: `{ matched, user, matchedBy }` with minimal profile payload.
5. New env vars in `prediction-market-mvp` backend:
   - `SUPPORT_PROFILE_LOOKUP_SECRET` (required).
   - `SUPPORT_PROFILE_LOOKUP_ENABLED=true` (optional feature flag).
   - Optional allowlist: `SUPPORT_PROFILE_LOOKUP_ALLOWED_IPS`.
6. DB performance dependency in `prediction-market-mvp`:
   - Ensure case-insensitive email lookup index exists for primary email (`LOWER(email)`), plus existing `LOWER(secondary_email)` and `phone_number` indexes for fast lookup.
7. Security/audit dependency in `prediction-market-mvp`:
   - Audit log event for each lookup request (success/fail, caller, query type) to align with existing audit model.

6esk Env Vars Needed For This Phase
- `PREDICTION_PROFILE_LOOKUP_URL`
- `PREDICTION_PROFILE_LOOKUP_SECRET`
- `PREDICTION_PROFILE_LOOKUP_TIMEOUT_MS` (default 1500)
- `PREDICTION_PROFILE_LOOKUP_RETRY_COUNT` (default 1)
- `PREDICTION_PROFILE_LOOKUP_ENABLED` (default true)

**Phase 9 Implementation Snapshot (2026-02-13)**
Implemented in `prediction-market-mvp`
- Added internal lookup route: `backend/src/api/routes/internalSupport.ts`
- Registered route in API bootstrap: `backend/src/api.ts`
- Added env template keys: `backend/.env.example`
- Endpoint implemented:
- `GET /api/v1/internal/support/users/lookup`
- Auth header: `x-6esk-secret`
- Query support: `email`, `phone`, `include_closed`
- Match targets: `users.email`, `users.secondary_email`, `users.phone_number`
- Response shape: `{ matched, matchedBy, user }`
- Audit logging added for success/failure/unauthorized lookup attempts.

Implemented in `6esk`
- Added integration client: `src/server/integrations/prediction-profile.ts`
- Added ticket metadata merge helper: `src/server/tickets.ts` (`mergeTicketMetadata`)
- Wired inbound email enrichment: `src/server/email/inbound-store.ts`
- Wired inbound WhatsApp enrichment: `src/server/whatsapp/inbound-store.ts`
- Added Support UI profile panel: `src/app/tickets/TicketsClient.tsx`
- Added persistent external user links table + migration: `db/migrations/0016_external_user_links.sql`
- Added external link upsert utility: `src/server/integrations/external-user-links.ts`
- Inbound email + WhatsApp now upsert `external_user_links` on matched enrichment
- Added env template keys: `.env.example`
- Lookup is fail-open: inbound ingestion continues even when lookup misses/fails/timeouts.
- Metadata stored on ticket:
- `profile_lookup` (status, source, lookup timestamp, error if any)
- `external_profile` (external user id, matchedBy, fullName, email, secondaryEmail, phoneNumber, kycStatus, accountStatus)
- Ticket event emitted on successful first-time enrichment: `profile_enriched`.

Activation checklist (required for live wiring)
1. Set `SUPPORT_PROFILE_LOOKUP_SECRET` in `prediction-market-mvp` backend env.
2. Set `PREDICTION_PROFILE_LOOKUP_SECRET` in 6esk env to the exact same value.
3. Set `PREDICTION_PROFILE_LOOKUP_URL` in 6esk to the prediction backend base URL.
4. Keep `SUPPORT_PROFILE_LOOKUP_ENABLED=true` and `PREDICTION_PROFILE_LOOKUP_ENABLED=true`.
5. Verify endpoint manually with secret header before end-to-end inbox testing.

Validation results captured
- `prediction-market-mvp/backend`: `npm run build` passed.
- `6esk`: `npm run test` passed, `npm run lint` passed, `npm run sanity` passed.

Working state note
- No commit and no push were performed for these changes (explicitly requested).

**WhatsApp Channel Plan**
Goal
- Add a first-class WhatsApp support channel without breaking email-first workflow.

Provider Decision
- Decision: Meta WhatsApp Cloud API (direct) — low cost, highest control, requires integration work.
- Alternative: Twilio/MessageBird if you prefer managed setup.
- Build provider adapter layer so the UI and data model stay provider-agnostic.

Dependencies
- Meta Business Manager + WhatsApp Business Account (WABA).
- Verified phone number for WhatsApp.
- HTTPS endpoint for webhooks.
- App secret for webhook verification.

Data Model Changes
- Add WhatsApp account table (phone number, provider, access token, WABA ID, status).
- Decision: extend existing `messages` table with a `channel` enum + WhatsApp metadata
  columns/JSONB (no separate WhatsApp message table) to keep tickets, analytics, and AI
  flows unified.
- Extend messages with channel metadata: `channel = whatsapp`, `external_message_id`,
  `conversation_id`, `wa_contact`, `wa_status`, `wa_timestamp`, `provider`.
- Optional contact table for WhatsApp identities (name, phone, last_seen).

Backend APIs
- `POST /api/whatsapp/inbound` for incoming messages + status callbacks.
- `POST /api/whatsapp/send` to send messages or templates.
- Idempotency keys for inbound events.
- Rate limiting for inbound + send endpoints.
- Agent actions payload (for WhatsApp):
  ```json
  {
    "type": "send_reply",
    "ticketId": "uuid",
    "channel": "whatsapp",
    "text": "…",
    "template": {
      "name": "order_update",
      "language": "en_US",
      "components": [{ "type": "body", "parameters": ["12345"] }]
    },
    "metadata": { "forceTemplate": false }
  }
  ```
  Rules: if outside 24h window and no template is provided, reject + create draft /
  request_human_review. When inside 24h, plain text is allowed.

Ticketing & Threading
- Each WhatsApp conversation maps to a ticket (platform mailbox).
- New inbound creates ticket, subsequent inbound appends to the same ticket.
- Thread ID stored as WhatsApp conversation ID.

UI/UX
- Channel badges (Email / WhatsApp) on tickets and messages.
- Message detail view renders WhatsApp bubbles and delivery status.
- Composer supports text + attachments; template chooser when required.
- Admin panel: connect number, manage templates, view connection status.

Operational & Compliance
- Enforce 24-hour customer care window.
- Template approval workflow for outbound messages outside window.
- Audit logs for WhatsApp sends + settings changes.

AI Parity (Venus / Agent Integration)
- Extend message storage to be channel-aware (add `channel` enum + WhatsApp metadata like `external_message_id`, `conversation_id`, `wa_contact`, `wa_status`, `wa_timestamp`).
- Emit agent outbox events for WhatsApp inbound/outbound with channel metadata and conversation references.
- Update agent context APIs to return channel fields, delivery status, and pointers for WhatsApp content/attachments.
- Extend agent actions to support WhatsApp replies (channel + template payloads) with 24h window enforcement.
- Auto-send is only allowed when policy allows and WhatsApp window/template rules pass; otherwise create draft + request human review.
- Audit log records AI-origin WhatsApp actions the same way as email (origin `ai`, `ai_meta`).

Milestones
1) Provider setup + webhook verification.
2) Inbound message ingestion + ticket creation.
3) Outbound send + template gating.
4) UI rendering + composer.
5) Status callbacks + analytics hooks.
6) AI parity: agent events + context + actions for WhatsApp with policy gates.

**Risks & Mitigations**
- Email provider lock‑in: keep inbound/outbound adapters thin and standardized.
- Catch‑all spam noise: basic spam tagging and mailbox rules in Phase 6.
- Storage growth: R2 lifecycle policies after MVP.

**UI/UX Plan (Functional CRM First)**
Principles
1. Design for the support agent’s job-to-be-done, not aesthetics.
2. Consistent layout and navigation across all pages.
3. Accessibility is required: contrast, keyboard nav, focus states, error states.
4. Mobile-first responsiveness, with touch targets >= 44x44.
5. Clear loading, empty, and error states for every async screen.

Scope of Improvements
1. App shell: persistent sidebar + header with unified navigation for Tickets, Mail, Analytics, Admin, and Settings.
2. Landing behavior: `/` redirects to `/tickets` for signed-in users and `/login` for guests; remove the route index landing.
3. Navigation wiring: “Platform” routes to `/tickets`, “Mail” to `/mail`, “Analytics” to `/analytics`, “Admin” to `/admin`.
4. Tickets UI: split view list/detail, status/priority filters, assignment controls, clear empty states, and fast keyboard navigation.
5. Mail UI: thread list + detail, consistent message actions, attachments preview, and mailbox switcher aligned with tickets.
6. Design system: tokenized colors/typography/spacing, reusable components, dark mode coverage.
7. Feedback states: toasts, alerts, skeletons, and error recovery actions.

Acceptance Criteria
1. After login, “Platform” always opens `/tickets` and the app shell persists across pages.
2. No dead-end pages; every menu item routes to a functional screen.
3. All primary flows are usable with keyboard-only navigation.
4. Empty states guide the user with clear next actions.

**Immediate Next Steps**
1. Validate Phase 9 end-to-end with live `prediction-market-mvp` data (email + WhatsApp recognized/missed/error paths).
2. Complete DNS + Resend verification and confirm inbound/outbound email delivery.
3. Continue Phase 7 hardening: monitor inbound retries in production and tune retry/alert thresholds.
4. Stand up WhatsApp Business account and confirm provider choice.
5. Implement remaining UI/UX plan refinements (tickets/mail workflows, design system polish).
