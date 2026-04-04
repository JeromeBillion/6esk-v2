# 6esk v2 Commercialization Roadmap (Multi-Tenant SaaS)

## Purpose
`6esk v2` is the independence and go-to-market version of the product: a true multi-tenant B2B SaaS platform, no longer a custom internal CRM for `6ex`.

This roadmap starts only after `v1` is fully working.

## Product Thesis
`6esk v2` sells the operating model currently implied by the landing page:
- every serious support channel in one surface
- optional AI automation across text and voice
- human operators can step in without losing context
- modular commercial packaging
- enterprise-grade trust, telemetry, and controls

## Baseline Assumptions
- architecture: true multi-tenant SaaS
- `v2` can run with no Venus dependency
- a forked AI orchestration module will originate from Venus, but be packaged as a 6esk module
- customers may choose:
  - no AI
  - 6esk-managed AI orchestration
  - bring-your-own AI API/provider
- landing page and public GTM site are `v2` scope, not `v1` scope
- internal business operations for the SaaS must have their own platform/workspace (`6esk Work`)

## Commercial Packaging Model
### Core Platform (included)
These should not be priced as standalone add-ons:
- support workspace shell
- analytics
- admin
- operations tooling
- human-to-6esk vanilla webchat

### Billable Modules
- email workspace connectivity
- managed email service
- WhatsApp
- voice
- AI automation
- AI orchestration service module (forked from Venus)
- bring-your-own AI provider mode
- implementation / professional services (business-side offering)

### Email Module Modes
The email offer must be modular, because `6esk v2` should be able to replace the need for a separate workspace/email-tool subscription for some customers, while integrating cleanly with existing providers for others.

Supported modes:
1. Connected email workspace
   - connect Google Workspace, Microsoft 365, or another supported provider
   - use OAuth/API/IMAP-SMTP integration where appropriate
   - 6esk operates the support workflow while the customer keeps its existing mailbox provider
2. Managed 6esk email service
   - 6esk provisions and operates the support email layer for the customer's domain
   - 6esk can offer mailboxes, aliases, routing, and support inboxes without the customer buying a separate workspace tool just to run support

Commercial rule:
- some customers will buy only the CRM + connect their own provider
- some customers will buy the full managed stack, including email service
- both modes must be tenant-safe and interchangeable without product rewrites

### AI Commercial Rule
If a customer uses our managed AI stack:
- they pay the AI module price inclusive of our orchestration/runtime margin and token cost model

If a customer brings their own AI API/provider:
- token cost is removed from our pricing model
- we still charge for our orchestration/runtime layer and support margin

## v2 Success Criteria
`6esk v2` is ready for market only when all of the following are true:
1. Tenants are isolated safely in a true multi-tenant architecture.
2. Customers can be provisioned, billed, configured, and supported as external companies.
3. Every billable module can be turned on/off per tenant without code forks.
4. AI can be disabled, 6esk-managed, or BYO-provider.
5. Email can run in either connected-provider mode or 6esk-managed service mode.
6. Security posture is strong enough for real procurement and enterprise review.
7. South Africa legal/compliance requirements are met and international readiness is planned.
8. `6esk Work` exists as the internal backoffice for running the SaaS business.

## Workstream A: Multi-Tenant Core Architecture
### Required Platform Shifts
1. Introduce first-class `tenant`, `organization`, and `workspace` boundaries.
2. Enforce data isolation in every API, worker, integration, and analytics path.
3. Make all connectors tenant-aware:
   - email
   - managed email service
   - WhatsApp
   - voice
   - webchat
   - AI orchestration
4. Add tenant-safe secret storage and rotation.
5. Add tenant lifecycle operations:
   - provision
   - suspend
   - downgrade
   - close
   - export
   - delete/anonymize

### Required Technical Controls
- row-level or service-layer tenant isolation
- per-tenant encryption/key strategy where justified
- tenant-safe background jobs and queues
- tenant-aware audit logs
- environment promotion model that does not leak tenant data

## Workstream B: Authentication, Identity, and Access
### Must-Haves
- OAuth / OpenID Connect support
- SSO readiness for enterprise customers
- MFA for admin and sensitive roles
- SCIM or later-directory-sync roadmap for enterprise lifecycle management
- stronger role and permission model beyond current internal assumptions
- session policies, device/session visibility, and revoke controls

### Commercial Requirement
Auth can no longer assume a single internal company operating model. Identity must support:
- multiple companies
- multiple workspaces
- external admins
- external operators
- partner/professional-services access where needed

## Workstream C: Feature Entitlements, Packaging, and Metering
### Goal
Commercial packaging must be enforced by system design, not sales promises.

### Required Capabilities
1. Entitlement engine for channels and AI modules.
2. Metering for:
   - connected email volume
   - managed email mailboxes / aliases / seats / sending volume
   - WhatsApp volume/templates
   - voice usage
   - AI text actions
   - AI voice actions
   - orchestration runtime consumption
3. Plan/catalog model:
   - core plan
   - add-on modules
   - usage-based metrics
4. Downgrade/upgrade behavior with safe transitions.
5. Tenant-facing visibility into enabled modules and usage.

### Revenue-Supporting Requirement
The system must distinguish:
- human-only channel usage
- AI-assisted usage
- fully autonomous AI usage
- BYO-provider AI usage

### Email Service Commercial Requirement
The platform must support two distinct email commercial models:
1. Bring-your-own email workspace
   - connect an existing Google Workspace, Microsoft 365, or equivalent provider
   - ingest/send mail without forcing mailbox migration
2. 6esk-managed email service
   - provision email support capability directly for the customer's domain
   - reduce or eliminate the customer's need for a separate workspace-style support mail tool

This means packaging, entitlement, metering, onboarding, and support flows must all understand the difference between:
- connected provider mail
- managed 6esk mail

## Workstream D: Email Service Productization
This is a separate workstream because once 6esk offers hosted/managed email, we are no longer only integrating with email systems. We are partially becoming one.

### Product Requirement
Customers must be able to choose between:
1. Connected-provider email
2. Managed 6esk email service

### Connected-Provider Requirements
- OAuth and provider integration for Google Workspace and Microsoft 365 first
- mailbox import/sync model
- shared inbox routing and send-as behavior
- provider token lifecycle and refresh handling
- failure visibility when provider auth or sync breaks

### Managed Email Service Requirements
- customer domain onboarding flow
- DNS verification flow
- SPF / DKIM / DMARC setup and validation
- mailbox and alias provisioning
- Cloudflare Email Routing sync from `6esk`
- when an admin creates a user or mailbox in `6esk`, `6esk` also creates or updates the corresponding Cloudflare custom address rule automatically
- outbound delivery infrastructure or provider partnership
- inbound routing into 6esk
- bounce, complaint, suppression, and deliverability handling
- mailbox ownership, suspend, delete, and export lifecycle

### Business And Ops Implications
If 6esk offers managed email service, we also need:
- deliverability monitoring
- sender reputation management
- abuse/spam controls
- domain warm-up and sending policy controls
- support process for DNS and domain onboarding issues
- clear customer responsibility split for domain ownership and DNS changes

### Commercial Requirement
Managed email service must meter and bill differently from connected-provider email.
The roadmap must support:
- mailbox/seat pricing
- alias/domain pricing if needed
- sending-volume pricing if needed
- onboarding/service fees where justified

### Exit Criteria
- a customer can either connect existing mail or buy managed mail from 6esk
- both modes end in the same operator experience inside the product
- both modes are observable, billable, and supportable

## Workstream E: AI Productization
### Product Requirement
The current Venus-derived capability must become an optional `6esk` module, not a hidden internal dependency.

### Modes To Support
1. No AI.
2. `6esk` managed AI orchestration.
3. BYO AI provider/API.
4. Optional future partner-hosted AI modes.

### Required Architecture
- provider abstraction layer
- cost/margin model by provider mode
- prompt/policy/runtime controls owned by 6esk
- event/audit trail for every AI action
- escalation semantics that preserve full context
- tenant-level AI policy controls
- STT abstraction owned by `6esk`, but the `v2` product target is explicitly AI STT rather than legacy telephony-provider transcription
- `v2` STT must include proprietary built-in speaker diarization owned by the `6esk` platform layer
- `v2` STT must include proprietary built-in utterance segmentation owned by the `6esk` platform layer
- provider adapters may still exist underneath, but diarization and utterance semantics must be normalized and controlled by `6esk`, not delegated blindly to whichever vendor is active

### Explicit Commercial Rule
BYO AI should reduce customer cost materially, but 6esk still owns:
- orchestration
- policy enforcement
- safety rails
- routing/runtime layer
- auditability

### Voice / Transcript Product Rule
- call recordings and transcripts remain `6esk` artifacts, not provider-owned artifacts
- telephony transport and transcription transport must be swappable independently
- transcript generation is mandatory for voice-enabled tenants
- `v2` must use AI STT as the canonical transcription path
- diarization and utterance segmentation are mandatory platform capabilities, not optional add-ons
- `6esk` must expose a consistent transcript structure to downstream QA, summarization, and analytics regardless of which STT vendor is active
- transcript-derived AI layers are separate from STT and should be modeled explicitly:
  - summary
  - resolution note
  - QA flags
  - action items
- QA flags are a first-class commercial product capability for voice-enabled AI tenants and should remain explainable against the underlying raw transcript

## Workstream F: South Africa Compliance Baseline
This section covers what we should plan for based on South Africa requirements and what serious B2B customers will expect.

### Minimum South Africa Compliance Baseline
1. POPIA compliance program.
2. Information Officer registration and operating process.
3. PAIA private-body obligations and reporting/manual requirements.
4. Security compromise notification process.
5. Cross-border transfer posture for customer data and subprocessors.
6. Contractual and policy treatment for call recordings, transcripts, and monitoring.
7. VAT and invoicing treatment for SaaS/electronic services.

### What This Means In Practice
#### POPIA
We need:
- lawful processing basis inventory
- operator agreements / DPA equivalents
- retention and deletion rules
- access-control and security safeguards
- breach response and notification workflow
- data subject rights handling
- direct-marketing and consent rules where relevant

#### PAIA
We need:
- private-body PAIA manual/process ownership
- request handling process
- annual/reporting obligations as applicable

#### Voice / Recording
We need a counsel-approved position for:
- recording consent language
- transcript retention
- monitoring/interception boundaries
- region-specific differences where customers operate outside South Africa

#### VAT / Finance
We need:
- SaaS billing model validated for South Africa
- VAT treatment and invoicing flow
- finance controls for recurring subscriptions and usage billing

#### Email Service / Domain Operations
We need a compliant and supportable position for:
- customer-domain verification and control
- mailbox retention and deletion
- cross-border handling where email data or providers sit outside South Africa
- outbound sender reputation and complaint handling
- terms governing hosted email service vs connected-provider integration

### Enterprise Readiness Beyond Legal Minimum
South Africa legal minimum is not enough for SaaS growth. We should also plan for:
- SOC 2 readiness
- ISO 27001 readiness
- vendor security questionnaire workflow
- trust center / subprocessor list / penetration testing evidence

## Workstream G: Security Program
### Required Platform Security Upgrades
1. secrets management and rotation discipline
2. stronger audit logs and immutable event provenance
3. encryption in transit and at rest review
4. least-privilege access model across services and ops
5. vulnerability management and patch SLAs
6. dependency/SAST/DAST/container scanning
7. backup, restore, and disaster-recovery drills
8. tenant data export and deletion controls
9. abuse prevention / spam / fraud controls
10. admin hardening, break-glass, and privileged-access controls
11. stronger protection around tenant mailboxes, provider tokens, and hosted email domains

### Security Definition Of Done For Market Entry
- documented security program
- regular penetration testing
- incident response runbook
- backup restore proven
- tenant isolation verified
- customer-facing security documentation ready

## Workstream H: Telemetry, Reliability, and Supportability
The current internal-tool telemetry bar is not enough.

### v2 Must-Haves
- tenant-aware observability
- per-module health and latency dashboards
- AI cost and outcome telemetry
- delivery telemetry for email/WhatsApp/voice
- deliverability telemetry for managed email domains and outbound reputation
- SLOs/SLAs and alerting model
- public status page and incident comms workflow
- support diagnostics that do not require engineering access

### Why This Matters
A SaaS business dies if it cannot:
- explain failures quickly
- meter usage correctly
- prove service quality
- isolate one tenant's issue from another's

## Workstream I: Billing, Finance, and Revenue Operations
### Required Systems
1. pricing catalog and quote model
2. subscriptions and add-on module billing
3. usage-based billing for channels/AI where applicable
4. invoicing, VAT, collections, and dunning
5. plan changes, proration, credits, and refunds
6. finance reconciliation against provider spend
7. margin reporting by tenant/module
8. hosted-email cost and margin tracking separate from connected-email mode

### Missing From Current Internal-Tool Shape
The platform currently behaves like a product. `v2` must also behave like a business system.

## Workstream J: Customer Lifecycle and BizOps (`6esk Work`)
`6esk Work` is required. This is not optional admin polish.

### Purpose
Run the SaaS business itself:
- tenant onboarding
- implementation tracking
- contract state
- module entitlements
- usage review
- renewals
- incidents
- support escalations
- finance visibility
- AI/provider configuration ownership

### Minimum Internal Backoffice Capabilities
1. account and subscription management
2. entitlement management
3. onboarding and implementation pipeline
4. support and incident coordination
5. finance and collections visibility
6. tenant usage and health overview
7. audit of internal operator actions
8. partner/pro-services workflow management
9. email-domain onboarding and deliverability support workflow

## Workstream K: GTM and Public Company Readiness
### Required Non-Code Assets
- pricing page
- legal terms and privacy policy
- DPA / operator agreement pack
- subprocessor list
- trust/security page
- status page
- help center / docs
- onboarding/training materials
- product update/change communication flow

### Required Commercial Processes
- sales-assisted onboarding
- implementation playbooks
- support SLAs
- escalation paths
- renewal process
- customer success/account ownership model

## Things Most Commonly Forgotten When Turning An Internal Tool Into A Business
These are the gaps teams usually underestimate:
1. tenant isolation and safe migration tooling
2. entitlement and billing enforcement drift
3. data export/offboarding/delete workflows
4. contract/DPA/subprocessor governance
5. support, incident, and status-page process ownership
6. finance reconciliation and margin visibility
7. backup/restore drills under real customer expectations
8. procurement and security questionnaire handling
9. abuse/fraud/spam controls for outbound channels
10. internal backoffice tooling for the SaaS operator team
11. usage metering that customers can trust
12. documentation and training good enough for non-engineers

## Recommended Execution Order
### Phase 0: lock v1 first
- do not commercialize before `v1` is truly complete

### Phase 1: commercial architecture foundation
- multi-tenant model
- entitlements
- auth/identity model
- tenant-safe connectors

### Phase 2: security and compliance baseline
- POPIA / PAIA / Info Officer processes
- legal docs
- security controls
- incident and status posture

### Phase 3: packaging and monetization
- billing/metering/catalog
- AI provider modes
- customer-facing plan structure

### Phase 4: bizops operating system
- `6esk Work`
- onboarding, renewals, finance, support ops

### Phase 5: GTM launch readiness
- public docs
- trust artifacts
- pricing
- implementation and support model

## Sources Checked For South Africa Planning
These should be revisited with legal/compliance review before launch, but they are the correct planning inputs to anchor now.
- Information Regulator South Africa home / POPIA / PAIA / Information Officer registration:
  - https://inforegulator.org.za/
- POPIA statutory source:
  - https://www.gov.za/documents/protection-personal-information-act
- SARS VAT overview:
  - https://www.sars.gov.za/types-of-tax/value-added-tax/
- SARS VAT registration guidance:
  - https://www.sars.gov.za/types-of-tax/value-added-tax/register-for-vat/
- SARS electronic services guidance:
  - https://www.sars.gov.za/guide-to-supply-of-electronic-services-by-foreign-suppliers-and-foreign-intermediaries/

## v2 Definition Of Done
`6esk v2` is done when it is no longer merely a strong internal product, but a real company-ready SaaS platform with:
- true multi-tenancy
- commercial packaging
- AI optionality
- security and compliance maturity
- billing and metering
- supportable operations
- a working internal backoffice (`6esk Work`)
- a go-to-market surface that matches what the product can actually deliver
