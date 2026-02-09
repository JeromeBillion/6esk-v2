Inbound Email Payload (Cloudflare Worker -> 6esk)

Endpoint: `POST /api/email/inbound`
Optional header: `x-6esk-secret` (matches `INBOUND_SHARED_SECRET`)

Required fields
- `from`: string
- `to`: string or string[]

Optional fields
- `cc`: string or string[]
- `bcc`: string or string[]
- `category`: string
- `tags`: string[]
- `metadata`: object
- `subject`: string
- `text`: string
- `html`: string
- `raw`: base64-encoded RFC822 message
- `messageId`: string
- `inReplyTo`: string
- `references`: string[]
- `date`: ISO8601 string
- `attachments`: array of
  - `filename`: string
  - `contentType`: string
  - `size`: number
  - `contentBase64`: base64-encoded bytes

Example
```json
{
  "from": "Customer <customer@example.com>",
  "to": ["support@6ex.co.za"],
  "category": "payments",
  "tags": ["payments", "withdrawal"],
  "metadata": {
    "userId": "uuid",
    "kycStatus": "approved"
  },
  "subject": "Billing issue",
  "text": "Hello, I need help with my invoice.",
  "messageId": "<abc123@example.com>",
  "date": "2026-02-09T12:00:00Z",
  "attachments": [
    {
      "filename": "invoice.pdf",
      "contentType": "application/pdf",
      "contentBase64": "JVBERi0xLjQKJ..."
    }
  ]
}
```

Outbound Email Payload (6esk -> Resend)

Endpoint: `POST /api/email/send`

Required fields
- `from`: string
- `to`: string or string[]
- `subject`: string

Optional fields
- `cc`: string or string[]
- `bcc`: string or string[]
- `text`: string
- `html`: string
- `replyTo`: string
- `attachments`: array of
  - `filename`: string
  - `contentType`: string
  - `contentBase64`: base64-encoded bytes

Ticket Create API (Platform -> 6esk)

Endpoint: `POST /api/tickets/create`
Optional header: `x-6esk-secret` (matches `INBOUND_SHARED_SECRET`)

Required fields
- `from`: string
- `subject`: string
- `description`: string

Optional fields
- `descriptionHtml`: string
- `category`: string
- `tags`: string[]
- `metadata`: object
- `attachments`: array of
  - `filename`: string
  - `contentType`: string
  - `contentBase64`: base64-encoded bytes
