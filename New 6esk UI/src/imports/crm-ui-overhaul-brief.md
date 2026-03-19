# CRM UI Overhaul Brief

## Purpose

This brief is for the next agent handling a complete CRM frontend overhaul in `6esk`.

The scope is:

- frontend only
- preserve current backend and API contracts
- preserve current product scope and workflows
- do not assume this is a sales CRM

This brief is intentionally factual and avoids prescribing a visual direction.

## Product Frame

- `6esk` is an omnichannel support CRM / service desk.
- The primary record is a `ticket`.
- Core channels are `email`, `WhatsApp`, and `voice`.
- The current product does not implement a sales pipeline, deals, or companies/accounts as first-class CRM objects.
- The frontend redesign should improve and reorganize the existing product, not invent a different product model.

## Current Top-Level App Modules

- `Support`
- `Mail`
- `Analytics`
- `Admin`
- public support portal
- auth flows

## Core Modules

### Support

Primary agent workspace for ticket triage and customer communication.

Includes:

- ticket queue
- filters and saved views
- ticket detail
- customer context
- conversation thread
- AI draft workflows
- merge workflows
- WhatsApp actions
- voice actions

### Mail

Personal mailbox workspace for an assigned agent mailbox.

Includes:

- inbox
- starred
- sent
- thread expansion
- message detail
- compose
- reply
- forward
- pin/star
- attachment preview

### Analytics

Support operations analytics.

Includes:

- overview KPI cards
- SLA metrics
- ticket volume
- channel performance
- voice outcomes
- WhatsApp delivery trend
- merge metrics
- exportable grouped performance tables

### Admin

Operational configuration and review surface.

Includes:

- users
- create user
- SLA targets
- tags
- spam rules
- AI agent
- WhatsApp
- profile lookup
- security
- call ops
- inbound failures
- spam review
- audit log

### Public Support Portal

Unauthenticated customer-facing page for:

- ticket submission
- voice callback consent revocation

## Key Workflows

### Support Intake

- customer submits request by portal, email, WhatsApp, or voice
- ticket is created
- agent triages and assigns
- agent responds on the appropriate channel
- ticket moves through resolution states

### Ticket Triage

- browse queue
- filter by status, priority, tag, assignee, channel, or search query
- use saved views
- bulk select tickets
- bulk update status, priority, tags, or assignee

### Ticket Handling

- open ticket detail
- inspect conversation timeline
- inspect ticket events and audit records
- inspect requester profile and recent history
- update status, priority, assignment, and tags

### Email Handling

- open message thread
- inspect message detail
- reply
- forward
- compose new message
- include attachments

### WhatsApp Handling

- inspect WhatsApp conversation thread
- review sendability context
- handle template or freeform reply constraints
- send attachments
- inspect message delivery, read, and failure history

### Voice Handling

- inspect call options for a ticket
- respect consent and policy gates
- initiate outbound support call
- inspect call state progression
- review transcript and recording readiness
- follow up within the ticket

### AI Draft Workflow

- review generated draft queue items
- insert draft into reply
- edit draft
- approve and send
- dismiss draft

### Merge Workflow

- search duplicate ticket or customer candidates
- run preflight
- inspect impact summary
- confirm merge
- review pending/rejected/failed merge queue items

### Admin Workflow

- manage users and roles
- manage SLA settings
- manage tags and spam rules
- inspect inbound failures and security state
- inspect call ops and retry/recovery surfaces
- inspect audit data

### Analytics Workflow

- choose date range
- filter by agent, tag, priority, and WhatsApp source
- inspect KPI cards and trends
- export CSV reports

## Views and Pages Required

- signed-in application shell
- support workspace
- new ticket creation page
- personal mail workspace
- analytics page
- admin page
- public support page
- login page
- reset password page
- home page

## Domain Model

### Ticket

Primary operational record.

Fields surfaced in the current UI include:

- `id`
- `requester_email`
- `subject`
- `category`
- `metadata`
- `tags`
- `status`
- `priority`
- `assigned_user_id`
- `has_whatsapp`
- `has_voice`
- `created_at`
- `updated_at`

### Customer / Requester Profile

Used as contextual identity around a ticket.

Fields surfaced in the current UI include:

- registered or unregistered state
- display name
- primary email
- primary phone
- linked identities
- recent customer history

### Message

Conversation item under a ticket or mailbox thread.

Fields surfaced in the current UI include:

- `id`
- `direction`
- `channel`
- `origin`
- sender / recipient data
- `subject`
- preview text
- text body
- HTML body
- `thread_id`
- sent / received timestamps
- read state
- starred state
- pinned state
- attachment presence

### Message Detail Extras

Additional detail shown depending on channel.

Includes:

- attachment list
- reply recipient options
- spam flags
- transcript
- call session info
- channel status history

### Attachment

Fields surfaced in the current UI include:

- `id`
- filename
- content type
- size
- preview/download URL

### Draft / Draft Queue Item

AI-generated assistance for replies.

Fields and states surfaced in the current UI include:

- associated ticket
- draft preview/body
- queue selection state
- review/approval state

### Macro / Quick Reply

Reusable reply content.

Fields surfaced in the current UI include:

- title or label
- body content

### WhatsApp Template

Template-driven outbound content for WhatsApp.

Fields surfaced in the current UI include:

- template identity
- parameter requirements
- previewability
- send context

### Call Option Candidate

Possible outbound call targets for a ticket.

Fields surfaced in the current UI include:

- phone number
- label/source
- selection state

### Call Consent Snapshot

Voice policy context shown before initiating a call.

Fields surfaced in the current UI include:

- allowed or blocked state
- reason/block explanation
- relevant contact basis

### Call Session / Voice Record

Voice interaction state within the ticket workspace.

Fields surfaced in the current UI include:

- session id
- direction
- lifecycle state
- terminal outcome
- duration
- transcript
- recording readiness
- event history

### Ticket Event

Operational timeline item for a ticket.

Fields surfaced in the current UI include:

- type
- actor/system source
- timestamp
- summary payload

### Audit Log

Administrative or ticket-level change tracking.

Fields surfaced in the current UI include:

- actor
- action
- target
- timestamp
- metadata

### Merge Review Item

Review queue entry for merge operations.

Fields surfaced in the current UI include:

- review type
- source record
- target record
- pending/applied/rejected/failed state
- reason or failure detail

### Merge Preflight

Impact summary before merge confirmation.

Fields surfaced in the current UI include:

- candidate summary
- impact counts
- confirmation requirements

### Mailbox

Fields surfaced in the current UI include:

- `id`
- `address`
- `type`

### User

Fields surfaced in the current UI include:

- `id`
- name
- email
- role
- mailbox context
- status

### Role

Current role set:

- `lead_admin`
- `agent`
- `viewer`

### SLA Config

Fields surfaced in the current UI include:

- first response target
- resolution target
- compliance metrics

### Operations Records

Admin-facing operations entities currently surfaced include:

- spam messages
- inbound failures
- inbound alert config
- call outbox metrics
- failed call events
- webhook rejection metrics
- security status

## Relationships

- a ticket belongs to a requester/customer identity
- a ticket has many messages
- a ticket has many events
- a ticket has many audit entries
- a ticket can have many tags
- a ticket can be assigned to a user
- a ticket can contain email, WhatsApp, and voice interactions
- a message can have many attachments
- a customer can have many tickets
- a draft queue item belongs to a ticket/conversation context
- a merge review item links source and target ticket/customer records
- a user can own a personal mailbox
- analytics aggregate across tickets, channels, merges, and operations data

## User Actions Required

- create ticket
- edit ticket state
- assign ticket
- tag and untag ticket
- search tickets
- filter tickets
- save views
- bulk update tickets
- open ticket detail
- inspect customer profile
- inspect customer history
- inspect ticket events
- inspect audit logs
- reply on email
- reply on WhatsApp
- send attachments
- initiate outbound call
- handle candidate selection for calls
- review transcript and recording state
- use macros / quick replies
- review AI drafts
- edit/approve/send/dismiss drafts
- perform merge search/preflight/confirm
- review merge queue items
- manage personal mailbox messages
- star/pin messages
- export analytics CSV
- manage admin configuration
- inspect operational failures and queues

## Functional UI Requirements

The new frontend should support:

- dense, high-throughput agent work
- fast master-detail navigation
- conversation-first support workflows
- side-context for customer history and profile
- queue and review interfaces
- bulk actions
- form-heavy operational screens
- timeline/event views
- attachment previews
- metrics cards, tables, and charts
- modal or confirmation patterns for high-risk operations
- desktop and mobile usability

## What This Product Is Not

The current product is not scoped as:

- a sales CRM
- a deal/opportunity pipeline
- an account/company hierarchy product
- a calendar-based CRM

The next agent should not assume those concepts are required unless the product scope changes separately.

## Technical Constraints

- frontend only
- preserve existing API contracts
- preserve current route coverage
- preserve existing workflows and entity model
- current stack is `Next.js 15`, `React 19`, and `TypeScript`
- current styling is custom CSS in `src/app/globals.css`
- no existing dependency on a component library is required by the current codebase

## Existing API / Integration Surfaces The UI Depends On

The current frontend already depends on backend/API surfaces for:

- tickets
- ticket actions
- customers and profile lookup
- mailboxes
- messages
- attachments
- email send
- WhatsApp send/status/templates
- voice/call initiation and lifecycle
- analytics
- admin operations
- security
- audit data

## Existing Routes and Frontend Surfaces

Important frontend surfaces currently live in:

- [AppShell](C:/Users/choma/Desktop/6esk/src/app/components/AppShell.tsx)
- [TicketsClient](C:/Users/choma/Desktop/6esk/src/app/tickets/TicketsClient.tsx)
- [AdminClient](C:/Users/choma/Desktop/6esk/src/app/admin/AdminClient.tsx)
- [MailClient](C:/Users/choma/Desktop/6esk/src/app/mail/MailClient.tsx)
- [AnalyticsClient](C:/Users/choma/Desktop/6esk/src/app/analytics/AnalyticsClient.tsx)
- [NewTicketClient](C:/Users/choma/Desktop/6esk/src/app/tickets/new/NewTicketClient.tsx)
- [SupportFormClient](C:/Users/choma/Desktop/6esk/src/app/support/SupportFormClient.tsx)
- [globals.css](C:/Users/choma/Desktop/6esk/src/app/globals.css)
- [package.json](C:/Users/choma/Desktop/6esk/package.json)

## Implementation Guidance For The Next Agent

The next agent should treat this as:

- a full frontend redesign
- over existing support CRM functionality
- with freedom on visual language and component structure
- without changing the underlying product model

The next agent should maintain:

- feature parity
- route parity or a clearly reasoned route migration
- existing backend compatibility
- support for email, WhatsApp, and voice as first-class channels

