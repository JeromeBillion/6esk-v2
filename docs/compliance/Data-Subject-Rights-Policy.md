# Data Subject Rights Handling Policy

This policy governs how 6esk handles requests from individuals (Data Subjects) regarding their personal information.

## 1. 6esk's Role: Operator vs Responsible Party
Under POPIA (and GDPR equivalents):
- **Responsible Party (Controller):** 6esk acts as a Responsible Party for the personal data of our direct B2B customers (e.g., the billing contact or admin user who signs up for 6esk).
- **Operator (Processor):** 6esk acts as an Operator for the personal data of the "End Users" who interact with our customers via email, voice, or WhatsApp. 

## 2. Handling Requests as a Responsible Party
If a direct B2B customer (e.g., a Tenant Admin) wishes to exercise their rights (Right to Access, Correction, Deletion, Objection):
1. **Intake:** The customer submits a request to `privacy@6esk.com` or via the `6esk Work` backoffice portal.
2. **Verification:** Support staff verify the identity of the requester.
3. **Execution:** 
   - **Access:** An export of their profile and billing data is generated.
   - **Correction:** The customer is directed to the UI or support updates the database.
   - **Deletion:** The tenant is scheduled for closure and data destruction per the data retention lifecycle.
4. **Timeline:** Requests are fulfilled within 30 days.

## 3. Handling Requests as an Operator
If an End-User (e.g., someone who called a 6esk tenant's support line) contacts 6esk directly to exercise their rights:
1. **Intake:** The request is received at `privacy@6esk.com`.
2. **Identification:** 6esk identifies which Tenant(s) the end-user's data belongs to.
3. **Forwarding:** 6esk **does not** act on the request directly. Instead, 6esk forwards the request to the relevant Tenant (the Responsible Party) within 3 business days.
4. **Tooling:** 6esk provides the Tenant with the necessary software capabilities (e.g., UI buttons or API endpoints) to search, export, and delete the specific end-user's records (tickets, call transcripts, emails).
5. **Notification:** 6esk notifies the end-user that their request has been forwarded to the Responsible Party.

## 4. Platform Capabilities for Compliance
To enable our tenants to comply with their own POPIA obligations, the 6esk platform provides:
- **Search & Export:** The ability to search across all modules (tickets, WhatsApp, AI transcripts) for a specific email or phone number.
- **Redaction/Deletion:** The ability to delete an entire customer record and cascade delete their associated communications.
- **Audit Logging:** An immutable record of when a data subject's information was exported or deleted by the tenant admin.
