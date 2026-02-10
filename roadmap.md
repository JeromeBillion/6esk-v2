6esk MVP Roadmap

**Product Summary**
6esk is a lightweight helpdesk with a built‑in, two‑way email system. The MVP is a fast, analytics‑first support platform for a single org (6ex Support), with email as the primary channel and a clean operator workflow for tickets and personal mail. 6esk also exposes AI‑ready integration points so an external ElizaOS agent can draft replies without embedding AI logic in this repo.

**Non‑Negotiables**
- Two‑way email is core and top priority (inbound + outbound + storage).
- Auth is required. No signup. Lead Admin creates accounts and roles in an admin panel.
- Mailboxes: platform mailbox `support@6ex.co.za` for CRM tickets.
- Mailboxes: personal mailbox `name@6ex.co.za` for direct partner/vendor/investor/staff email.
- All org addresses must be provisionable inside 6esk, no manual mailbox creation.

**Scope Definition (MVP)**
- Ticketing: email + web form inbound, ticket lifecycle, assignment, replies.
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
- Phase 4 complete: ticket core + platform web form UI + tag management.
- Phase 6 in progress: AI agent integration plumbing (registry, outbox, context/actions APIs, draft UI).
- Phase 7 in progress: retries/backfill, spam handling, rate limiting, alerting.

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

**Risks & Mitigations**
- Email provider lock‑in: keep inbound/outbound adapters thin and standardized.
- Catch‑all spam noise: basic spam tagging and mailbox rules in Phase 6.
- Storage growth: R2 lifecycle policies after MVP.

**Immediate Next Steps**
1. Complete DNS + Resend verification and confirm inbound/outbound email delivery.
2. Finish ticketing UI gaps (platform web form client UI + tag edit/delete).
3. Add admin password reset + basic audit log UI for user/role changes.
4. Finalize AI drafts flow (approve/send + working hours + escalation rules).
5. Start Phase 7 hardening: inbound idempotency + retry/backfill plan.
