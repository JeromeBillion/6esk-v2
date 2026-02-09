# Platform Support Integration Requirements (6ex -> 6esk)

This document describes the UI + data requirements needed in the 6ex platform to integrate with the 6esk support system.

## Goal
Connect 6ex user support requests to 6esk so that:
- Support requests from the platform become tickets in 6esk.
- Agents can respond from 6esk and users receive replies by email.
- The platform has a clear “Get Help” flow without extra tooling.

## Current Context (from 6ex repo)
- Platform uses Resend for email and already references `support@6ex.co.za`.
- Frontend has a Help page with a support email link.
- Backend has email utilities and support email configuration (`SUPPORT_EMAIL`, `SUPPORT_URL`).
- Auth is OTP email, with user IDs and profile data available in the backend.

## UI Requirements (Platform)
Add the following UI support touchpoints:
1. Help Center entry in menu or header.
2. Help page should include a “Contact Support” button that opens a ticket form.
3. Error states (account frozen, KYC rejected, withdrawal issues) should include a “Contact Support” CTA.
4. Optional: a “Report an Issue” button in Wallet, Portfolio, and Trade Confirmation screens.

## Ticket Form Requirements (Platform)
The ticket form should capture:
- Subject
- Category tag
- Description
- Attachments (optional)
- Contact email (prefilled from logged-in user)
- User ID (hidden)
- Context metadata (hidden)

Category tags (use one):
- payments
- markets
- account
- kyc
- security
- general

Default tag rules (if category not supplied):
- If subject/body contains “kyc”, “verification”, “ID”, “selfie” -> tag `kyc`
- If subject/body contains “withdraw”, “deposit”, “wallet”, “payment” -> tag `payments`
- If subject/body contains “trade”, “market”, “liquidity”, “price” -> tag `markets`
- If subject/body contains “otp”, “login”, “email verification” -> tag `account`
- If subject/body contains “frozen”, “security”, “fraud” -> tag `security`
- Otherwise -> tag `general`

Context metadata to include with ticket:
- User ID
- Primary email
- Secondary email (if any)
- KYC status
- Account status (active/frozen)
- Last trade ID (if submitting from trade screen)
- Last withdrawal/deposit ID (if from wallet screen)
- Device info (user agent)
- App version

Attachments:
- Max size 10MB
- Allowed types: JPG, PNG, WebP, PDF

## Integration Options (Platform -> 6esk)

### Option A (Immediate): Email to support@6ex.co.za
Use existing backend email utilities to send an email to `support@6ex.co.za` with:
- From: user email
- Subject: ticket subject
- Body: description + context metadata
- Attachments included

Outcome:
- 6esk inbound email ingestion creates a ticket.
- Replies come back to user by email.

### Option B (Preferred API): HTTP ticket creation (future)
Once a 6esk public endpoint exists, the platform will post JSON to a ticket creation endpoint.

Proposed endpoint:
- `POST /api/tickets/create` (to be implemented in 6esk)

Proposed payload:
```json
{
  "from": "user@example.com",
  "subject": "Withdrawal pending",
  "category": "payments",
  "description": "I requested a withdrawal 3 days ago…",
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

Authentication:
- Shared secret header (e.g. `x-6esk-secret`) matching `INBOUND_SHARED_SECRET`.

## Support Macros (Initial Set)
1. KYC: Missing documents
2. Trading: Insufficient balance
3. Trading: Trade too large
4. Wallet: Withdrawals pending
5. Account: OTP not received
6. Security: Account frozen

## Ticket Lifecycle Expectations
- Ticket is created immediately after submission.
- User receives acknowledgement email.
- Responses arrive via email thread.
- Platform UI only needs a confirmation screen (no in-app inbox required in MVP).

## Copy Guidelines
Suggested copy for confirmation screen:
- “We’ve received your request. Our support team will reply to you by email.”

## Analytics Events (Platform)
Track the following:
- `support_form_opened`
- `support_form_submitted`
- `support_form_failed`
- `support_form_attachment_added`

## Open Questions
- Should users be able to view ticket history inside the platform UI later?
- Do we want multi-language support copy (English + local languages)?
- Should ticket category options be aligned with the same tags in 6esk analytics?
