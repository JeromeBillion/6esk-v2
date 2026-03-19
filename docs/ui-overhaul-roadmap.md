# UI Overhaul Roadmap

This tracker complements `docs/figma-ai-crm-ui-target-state.md`.

`docs/figma-ai-crm-ui-target-state.md` remains the visual and product target state.

This file tracks execution status across the actual app.

## Status Legend

- `done`: implemented and verified in the current app
- `partial`: visible and partly wired, but not feature-complete
- `missing`: required UI surface or workflow is not built yet
- `blocked-backend`: valid UI requirement, but current contracts do not fully support it

## Tracker

| Area | Route | Requirement | Current State | Target Behavior | Dependency | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shared | all routes | One design system and dark mode | Workspace primitives exist, public/auth pages still use legacy markup | Shared tokens, cards, forms, modals, and dark mode across app | frontend | `partial` | Shared primitives now power signed-in and public/auth surfaces through `PublicPageFrame`; theme state is centralized via a shared hook across `AppShell` and public/auth routes, with remaining work focused on edge-state visual parity |
| Support | `/tickets` | Queue filters | Status + search only | Status, priority, tag, channel, assignee filters | existing API | `done` | Status, priority, tag, channel, mine/any assignment filters, and saved-view apply behavior are wired |
| Support | `/tickets` | Bulk actions | Control visible without workflow | Real bulk update flow or tracked placeholder | bulk ticket endpoints | `done` | Bulk status/priority/assignee/tag updates are now wired with API-backed batch execution and queue-side bulk action controls |
| Support | `/tickets` | Saved views | Missing | Persist and recall saved queue presets | saved views contract | `done` | API-backed saved view persistence and Support-side save/apply/delete controls are now wired |
| Support | `/tickets` | Ticket detail editing | Status + priority only | Assignment, tags, category, metadata, audit/history | existing API | `done` | Assignment, tags, category, metadata, audit/history, canonical customer identities, interaction-history shortcuts, and customer profile write/edit controls are now wired |
| Support | `/tickets` | Reply tools | Text reply only | Macros, attachments, WhatsApp actions, call actions | existing API | `done` | Macro picker, attachments, WhatsApp window/template/resend flow, outbound call modal, and customer-identity-aware recipient targeting are wired |
| Support | `/tickets/merge-reviews` | Merge review queue | Missing | Pending/applied/rejected/failed review workflow | existing API | `done` | Dedicated queue route is implemented and linked from Support |
| Mail | `/mail` | Thread controls | Reply + star | Pin, forward, attachments, mailbox affordances | existing API | `done` | Pin, forward, attachment download, mailbox switch, macro/attachment composer wiring, per-message spam/unspam actions, dedicated spam queue view, URL-driven mailbox/view deep-linking, and thread-level read/unread controls (including auto-mark-read on open) are implemented |
| Analytics | `/analytics` | Full operational metrics | Core KPIs only | Merge metrics, WA delivery series, voice outcomes, richer exports | existing API | `done` | Previous-period KPI deltas, performance filters (agent/priority/tag), grouped CSV exports, merge actor split, top merge failure reasons, channel-specific drilldowns, and cross-route drill-throughs (merge reviews, channel queue jumps, top-tag queue links) are now surfaced |
| Admin | `/admin` | Reconnected admin modules | Core tabs restored | Password reset links, tag edit, inbound settings, failed event lists, call rejections, dead-letter summary, agent capability controls | existing API | `partial` | Password reset, structured tag editing, editable spam rules, security posture details, inbound alert telemetry, dead-letter filters/actions, recent call rejection events, richer agent provider/auth/scope controls, WhatsApp account controls, outbox metrics, full template CRUD, audit payload detail, per-row retry/review controls, and URL-driven operations deep links/shortcuts (including support/mail queue jumps) are now surfaced |
| New Ticket | `/tickets/new` | Modern create-ticket flow | Functional but off-system | Same design system as workspace app | frontend | `done` | Route stays stable with shared app shell/components, API-client-backed ticket create calls (no inline fetch), standardized feedback modal states, and richer payload controls (tag suggestions, email attachments, optional metadata JSON, and post-create support jump link) |
| Portal | `/support` | Public support form | Functional but off-system | Shared design language and feedback states | frontend | `done` | Uses shared `PublicPageFrame`, unified token-based styling, persisted theme toggle, voice-consent revoke flow, and standardized modal feedback states |
| Auth | `/login` | Login surface | Functional but off-system | Shared auth card, feedback, dark mode | frontend | `done` | Uses shared `PublicPageFrame` with centralized theme state, unified card/form styling, and standardized error feedback modal behavior |
| Auth | `/reset-password` | Reset password surface | Functional but off-system | Shared auth card, feedback, dark mode | frontend | `done` | Uses shared `PublicPageFrame` with centralized theme state, unified card/form styling, and standardized validation/success feedback modal behavior |

## Backend Follow-ups

- None currently. Add any newly discovered blocker here and link it to a tracker row above.

Any later-discovered blocker should be added here and linked back to the affected UI row above.
