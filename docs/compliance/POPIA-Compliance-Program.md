# 6esk POPIA Compliance Program Framework

This document outlines the foundation of 6esk's compliance with the Protection of Personal Information Act (POPIA) of South Africa. As a B2B SaaS platform processing customer support communications (email, voice, WhatsApp), 6esk primarily acts as an **Operator** on behalf of its customers (**Responsible Parties**). 

## 1. Information Officer Registration
- **Status:** [To Be Completed]
- **Information Officer:** [Name]
- **Deputy Information Officer:** [Name]
- **Registration Process:** Must be registered with the Information Regulator prior to full commercial launch.

## 2. Processing Inventory & Lawful Basis
6esk processes the following categories of personal information:
- **Tenant Admin Data:** Names, email addresses, billing details of our B2B customers. (Basis: Contractual Necessity)
- **End-User Data (Customer of Customer):** Support tickets, emails, phone numbers, WhatsApp chat logs, voice transcripts. (Basis: Processed strictly as an Operator on behalf of the Responsible Party).

## 3. Operator Agreements (DPA Equivalent)
- Standard Operator Agreements must be executed with all B2B customers.
- The agreement must stipulate that 6esk only processes data according to the customer's instructions and maintains appropriate security safeguards (Section 19-21 of POPIA).
- Sub-operators (e.g., AI providers, Twilio, Resend, Cloudflare) must be bound by equivalent written agreements.

## 4. Security Safeguards (Section 19)
6esk implements the following technical and organizational measures:
- **Multi-Tenant Isolation:** Enforced at the database row-level via `tenant_id` guarding.
- **Encryption:** All data encrypted in transit (TLS 1.2+) and at rest (AES-256).
- **Access Control:** Role-Based Access Control (RBAC), internal staff break-glass logging, and strict minimum-privilege policies.
- **AI Safety:** Provider modes explicitly isolate data when using managed models. Opt-in controls govern data usage for AI training.

## 5. Security Compromise Notification (Section 22)
See the `Incident-Response-Plan.md` for the explicit workflow detailing how 6esk notifies the Information Regulator and the Responsible Party "as soon as reasonably possible" following a suspected or actual data breach.

## 6. Retention and Deletion (Section 14)
- Personal information is retained only as long as necessary to fulfill the service.
- **Active Customers:** Data retained per the customer's configured retention policy.
- **Terminated Tenants:** 30-day grace period, followed by hard-deletion of all support records, transcripts, and object storage assets.
- **Backups:** Retained for [X] days, fully encrypted, and cycled automatically.

## 7. Cross-Border Transfers (Section 72)
- 6esk hosts primary infrastructure in [Region/Cloud Provider].
- Any transfer of personal information outside South Africa is protected by binding corporate rules, standard contractual clauses, or an operator agreement ensuring adequate protection levels equivalent to POPIA.

## 8. Data Subject Rights
As an Operator, 6esk does not respond directly to Data Subject requests (access, correction, deletion). We provide the tooling and APIs necessary for our B2B customers (the Responsible Parties) to execute these requests within the platform.
