# White-Label Webchat/Profile Plug Contract

This contract keeps webchat and profile enrichment optional and customer-owned. It is not a dependency on any internal 6esk-adjacent product.

## Supported Flow
Customer webchat or profile system -> signed 6esk ingress -> ticket/customer identity enrichment.

The external system may submit:
- a support ticket through `POST /api/tickets/create`
- authenticated end-user metadata through the ticket `metadata` object
- an `external_profile` object when the tenant has a profile plug enabled

6esk stores the supplied profile as tenant-scoped metadata and may link it to `customers` and `external_user_links`. 6esk may also call a tenant-configured external profile lookup plug through the `EXTERNAL_PROFILE_LOOKUP_*` contract when enabled.

## Required 6esk Configuration
- `INBOUND_SHARED_SECRET` for trusted machine ingress fallback
- `EXTERNAL_PROFILE_SYSTEM`
- `EXTERNAL_PROFILE_LOOKUP_ENABLED`
- `EXTERNAL_PROFILE_LOOKUP_URL`
- `EXTERNAL_PROFILE_LOOKUP_PATH`
- `EXTERNAL_PROFILE_LOOKUP_SECRET`
- `EXTERNAL_PROFILE_LOOKUP_TIMEOUT_MS`
- `EXTERNAL_PROFILE_LOOKUP_RETRY_COUNT`

## Profile Metadata Shape
```json
{
  "external_profile": {
    "source": "white-label-webchat",
    "externalUserId": "customer-123",
    "matchedBy": "session_auth",
    "matchedAt": "2026-06-02T10:00:00.000Z",
    "fullName": "Customer Name",
    "email": "customer@example.com",
    "secondaryEmail": null,
    "phoneNumber": "+27710000001",
    "kycStatus": null,
    "accountStatus": null
  },
  "profile_lookup": {
    "source": "white-label-webchat",
    "status": "matched",
    "matchedBy": "session_auth",
    "lookupAt": "2026-06-02T10:00:00.000Z"
  }
}
```

## Safety Rules
- The tenant/plugin supplies profile metadata; 6esk does not trust it as verified truth.
- Tenant scope and signature validation are mandatory in production.
- `source` must identify the tenant plug, not an internal development system.
- Conflicting external identities are recorded as conflicts and must not silently rebind canonical customer ownership.
- Human-visible workflows should label this as an external profile plug, not as an internal dependency.
