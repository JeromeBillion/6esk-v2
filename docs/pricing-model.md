# 6esk v2 Pricing Model

## Principle
6esk does not charge per seat.

The commercial model is:
- core platform access
- optional modules
- transparent usage and outcome charges
- provider costs passed through where the underlying provider drives the cost
- storage billed separately because it compounds over time

## Monthly Platform And Modules

| Item | Monthly Fee | Rule |
| --- | ---: | --- |
| Core OS | R699 | Required. Includes email workspace connectivity, support CRM, analytics, admin, vanilla webchat, and unlimited human users. |
| WhatsApp | +R499 | Enables Meta/WhatsApp channel operations. Provider message costs are billed separately with markup. |
| Voice | +R899 | Enables browser-call queue, voice workflow, recording, and provider integration. Provider call costs are billed separately with markup. |
| Managed AI | +R1,499 | 6esk-managed AI stack. AI actions are metered and managed-provider costs are shown separately. |
| BYO AI | +R899 | Customer brings their own AI key/provider. AI actions are still metered by 6esk; provider spend is paid directly by the customer. |

## Managed Email Service

Connected email is included in Core OS when the customer already has Google Workspace, Microsoft 365, Zoho, IMAP/SMTP, or another supported provider.

Managed 6esk email service is priced separately when the customer brings only a domain and expects 6esk to operate the support email layer.

| Item | Monthly Fee | Rule |
| --- | ---: | --- |
| Domain routing | R199 / domain | Domain-level inbound/outbound routing capability. |
| Mailbox | R79 / mailbox | Real mailbox/account operated by 6esk. |
| Alias | Free | Aliases do not create billing friction. |

## Variable Usage Fees

Drafts, retries, failed sends, duplicate webhooks, internal queue writes, UI refreshes, and audit logs are not billable.

| Usage | Price | Billing Rule |
| --- | ---: | --- |
| Inbound email processed | R0.03 | Charged after an inbound email is successfully processed into CRM. |
| Outbound email delivered | R0.05 | Charged only after delivery provider handoff succeeds. |
| WhatsApp | Provider cost + markup | No flat per-message platform fee. |
| Voice | Provider cost + markup | No flat per-call platform fee. |
| STT transcript | R0.35 / minute | Charged when transcript processing completes. |
| AI outcome/action | R1.00 | Charged for customer-visible AI outcomes, not internal reasoning steps. |
| Storage | R1.00 / GB-month | Charged for stored recordings, transcripts, email bodies, attachments, and other retained artifacts. |

Provider pass-through markup is currently set to 35%.

## One-Time Setup Fee

Setup remains scope-based and quoted separately.

Internal estimating rubric:
- data migration: R1,500 per 10k rows
- AI workflow setup: R2,500 per major workflow
- complex telephony/IVR: R1,000 per branch/region
- custom API integration: R3,500 per endpoint
- onboarding workshops: R1,200 per hour

## Billable AI Actions

These are the customer-visible AI outcomes currently treated as billable:
- AI reply drafted
- AI reply sent
- approved AI draft sent
- transcript analysis completed
- QA review completed
- resolution note generated
- action items extracted
- ticket triage/classification completed
- merge/link recommendation created
- customer profile enrichment completed
- call QA summary generated
- approved tool action executed
- AI-initiated call queued

Internal retrieval, prompt assembly, policy checks, denied actions, failed actions, and retry attempts are not separate billable AI actions.

## Implementation Contract

The executable source of truth is `src/server/tenant/catalog.ts`.

Billing and margin views must be able to explain every charge from stored usage events:
- module key
- usage kind
- provider mode
- quantity
- provider cost
- source metadata

If a future usage kind is not explicitly mapped as billable, it should default to non-billable until product and finance review it.
