# Platform Support Integration (6ex -> 6esk)

This is the minimal contract needed by the platform to open support tickets in 6esk.

## Goal
- Platform support submissions become 6esk tickets
- 6esk agents reply by email/WhatsApp using normal ticket workflows

## Preferred Integration
Use API ticket creation:
- `POST /api/tickets/create`
- Header: `x-6esk-secret: <INBOUND_SHARED_SECRET>`

Required body:
- `from` (email)
- `subject`
- `description`

Optional body:
- `descriptionHtml`
- `category`
- `tags`
- `metadata` (recommended)
- `attachments[]` (`filename`, `contentType?`, `contentBase64`)

Example:
```json
{
  "from": "user@example.com",
  "subject": "Withdrawal pending",
  "description": "I requested a withdrawal 3 days ago.",
  "category": "payments",
  "tags": ["payments", "withdrawal"],
  "metadata": {
    "userId": "uuid",
    "kycStatus": "approved",
    "accountStatus": "active",
    "latestWithdrawalId": "uuid",
    "device": "UA string",
    "appVersion": "v1.2.3"
  }
}
```

## Fallback Integration
If API is unavailable temporarily, send email to `support@6ex.co.za`.
Inbound email ingestion will still create tickets.

## Platform UX Requirements
- Provide a clear "Contact Support" action from Help and key error states
- Collect:
  - subject
  - description
  - optional attachment
  - user contact email (prefilled)
- Show confirmation after submit:
  - "We've received your request. Our support team will reply by email."

## Suggested Tag Set
- `payments`
- `markets`
- `account`
- `kyc`
- `security`
- `general`

## Suggested Platform Analytics Events
- `support_form_opened`
- `support_form_submitted`
- `support_form_failed`
- `support_form_attachment_added`
