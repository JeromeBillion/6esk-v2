# Tenant Ingress Signing Runbook

## Purpose
Machine ingress uses shared route secrets plus a tenant envelope signature. The shared secret proves the caller is allowed to hit the maintenance route. The tenant envelope proves the caller is allowed to claim a specific tenant/workspace for that exact method and path/query.

Use this runbook before enabling external-tenant production traffic, after every tenant ingress secret rotation, and after worker deployment changes.

## Required Configuration
- `TENANT_INGRESS_REQUIRE_SCOPE=true`
- `TENANT_INGRESS_REQUIRE_SIGNATURE=true`
- `TENANT_INGRESS_SIGNATURE_MAX_SKEW_SECONDS=300`
- `TENANT_INGRESS_TENANT=<tenant key used by the worker>`
- `TENANT_INGRESS_WORKSPACE=<workspace key used by the worker>`
- `TENANT_INGRESS_SECRET_ENCRYPTION_KEY=<long random secret for DB-stored ingress secrets>`
- route secret for the worker family, for example `INBOUND_SHARED_SECRET`, `WHATSAPP_OUTBOX_SECRET`, or `CALLS_OUTBOX_SECRET`

During rollout, workers may use `TENANT_INGRESS_SIGNING_SECRETS_JSON` with the one-time plaintext secret returned by the admin rotation API. Production should keep `TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET=false`.

## Rotation Procedure
1. Confirm migrations are applied, including `0046_tenant_ingress_signing_secrets.sql`.
2. In Admin, rotate a tenant ingress signing secret for the target tenant/workspace.
3. Copy the returned plaintext secret immediately. It is returned once only.
4. Distribute the plaintext to the worker environment as `TENANT_INGRESS_SIGNING_SECRETS_JSON`, keyed as `<tenant>:<workspace>`.
5. Deploy or restart the worker.
6. Run `npm run drill:tenant-ingress`.
7. Confirm the drill reports a 200 fresh request and a 401 path/query replay rejection.
8. Revoke retired secrets only after every worker using the old secret has been redeployed and the drill passes.

## Drill
Run:

```bash
npm run drill:tenant-ingress
```

The drill sends a signed request to `/api/admin/inbound/metrics?hours=1`, then reuses the same tenant signature against `/api/admin/inbound/metrics?hours=2`.

Expected production result:
- fresh signed request: `200`
- path/query replay: `401`

If the replay is not rejected while `TENANT_INGRESS_REQUIRE_SIGNATURE=true`, do not onboard external tenants.

## Release Evidence Capture
For release evidence, run:

```bash
npm run drill:tenant-ingress:evidence
```

This writes a redacted JSON evidence file under `.launch-evidence/tenant-ingress/`. The file records the tenant/workspace, strict-mode expectations, tested paths, response statuses, and replay rejection result. It does not write route secrets, signing secrets, tenant signatures, or request headers.

To choose a different evidence location:

```bash
node scripts/tenant-ingress-signature-drill.js --evidence-dir /secure/release-evidence/tenant-ingress
```

Attach the JSON evidence artifact to the launch checklist or release ticket before enabling external tenant traffic.

## Failure Handling
- `Tenant scope is required`: set `TENANT_INGRESS_TENANT` and `TENANT_INGRESS_WORKSPACE` for the worker.
- `Signed tenant envelope is required`: the worker is not sending timestamp/signature headers.
- `Tenant ingress signing secret is not configured`: set the env secret map or rotate a DB-backed secret and distribute it.
- `Tenant ingress signature is invalid`: check tenant/workspace keys, method, path/query, clock skew, and copied plaintext.
- replay drill returns `200`: signature enforcement is not enabled or the route is not using the shared tenant ingress verifier.

## Rollback
If a worker deployment breaks after rotation:
1. Mark the new secret as revoked only if it is known compromised.
2. Keep the old secret in `retiring` status while rolling workers back.
3. Restore the previous worker secret map.
4. Run the drill again.
5. Reattempt rotation after the worker fleet is stable.

## Launch Gate
External launch requires:
- route-level strict scope and signature enforcement enabled
- at least one active DB-backed tenant ingress signing secret per production tenant/workspace that has machine ingress
- no global signing-secret fallback in production
- successful redacted drill JSON captured in release evidence
- audit logs for every rotation and revocation
