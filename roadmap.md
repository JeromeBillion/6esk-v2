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

**Progress Update (2026-02-09)**
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
- Tickets UI cleanup: structured layout, empty states, keyboard shortcuts, quick actions.
- Admin polish: section counts, user search, role badges.
- AI workflow polish: ticket-level audit trail surfaced alongside drafts.
- Sidebar renamed from “Platform” to “Support.”
- Phase 4 complete: ticket core + platform web form UI + tag management.
- Phase 6 in progress: AI agent integration plumbing (registry, outbox, context/actions APIs, draft UI).
- Phase 7 in progress: retries/backfill, spam handling, rate limiting, alerting.
- Phase 8 in progress: WhatsApp scaffolding (schema, inbound/outbound endpoints, admin config UI).

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
- Agent shared secrets encrypted at rest when `AGENT_SECRET_KEY` is set.
- Optional IP allowlists for admin/agent endpoints added.
- Viewer role restricted from ticket mutations + outbound send; SLA/tag changes now audited.
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
- WhatsApp bubble view added to Support ticket conversations.
- WhatsApp template registry (admin) + Support template picker added.
- WhatsApp template parameter validation + status timeline added.
- WhatsApp payload preview + status history log + auto-refresh polling added.
- WhatsApp bubble status iconography (queued/sent/delivered/read/failed) added.
- WhatsApp template parameter preview chips added in Support reply panel.
- WhatsApp resend flow added for failed outbound messages (API + UI action).
- AI actions now accept WhatsApp templates; template-only replies supported for WhatsApp.
- AI drafts can carry WhatsApp template metadata and send with template on approval.

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
1. Complete DNS + Resend verification and confirm inbound/outbound email delivery.
2. Finish ticketing UI gaps (platform web form client UI + tag edit/delete).
3. Add admin password reset + basic audit log UI for user/role changes.
4. Finalize AI drafts flow (approve/send + working hours + escalation rules).
5. Start Phase 7 hardening: inbound idempotency + retry/backfill plan.
6. Stand up WhatsApp Business account and confirm provider choice.
7. Define WhatsApp AI parity spec (data model + agent events/actions + policy gates).
8. Implement the UI/UX plan above (app shell, routing, tickets/mail workflows, design system).
