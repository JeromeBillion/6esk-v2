# Tenant Migration Backfill Runbook

Use this runbook before removing the legacy `primary` tenant/workspace bridge or moving imported customer data into a real tenant/workspace.

## Source Of Truth

Postgres is the source of truth. The dry-run planner reads the live schema catalog and classifies every public table with a `tenant_key` column. Tables with both `tenant_key` and `workspace_key` are treated as workspace-scoped; tables with only `tenant_key` are treated as tenant-scoped.

The planner does not write database rows.

## Dry-Run Evidence

Set a production-like `DATABASE_URL`, then run:

```bash
npm run plan:tenant-backfill -- --target-tenant=<tenant-key> --target-workspace=<workspace-key>
```

The command writes a redacted JSON report under `.launch-evidence/tenant-backfill/`.

The report records:
- source and target tenant/workspace keys
- whether source and target tenant/workspace roots exist
- every impacted table still using the source scope
- row counts and sample row identifiers
- root tables that need manual handling
- SQL previews for child-row reassignment
- readiness reasons when the plan is not safe to apply

No secrets or row payloads are included.

## Reviewed Apply/Rollback Bundle

After the dry-run report is `readyToApply=true`, generate a reviewed SQL bundle:

```bash
npm run bundle:tenant-backfill -- --plan=.launch-evidence/tenant-backfill/<plan-file>.json
```

The bundle is written under `.launch-evidence/tenant-backfill-bundles/<bundle-id>/` and contains:
- `manifest.json`
- `apply.sql`
- `rollback.sql`
- `README.md`

The bundle generator does not connect to Postgres and does not execute SQL. `apply.sql` and `rollback.sql` are transactional scripts with row-count preconditions from the dry-run evidence. Bundle generation is blocked unless the target child scope is empty, because rollback would otherwise risk moving legitimate target rows back into the source scope.

## Required Preconditions

Before any write migration is approved:
- the target tenant exists in `tenants`
- the target workspace exists in `workspaces`
- the target organization/workspace ownership has been approved
- the dry-run report has no query errors
- ambiguous ownership has been resolved outside the migration
- the reviewed apply/rollback bundle has been attached to the release ticket
- a fresh `external_launch` tenant-isolation audit has been captured
- a database backup and restore test exists for the target environment

## Root Table Handling

Do not mutate primary keys in root tables while child references exist.

Create or verify the target tenant, organization, and workspace first. Reassign child rows only after those roots exist. Retire, isolate, or delete the source `primary` roots only after the post-migration audit passes and rollback is no longer needed.

## Rollback

Rollback must use the generated `rollback.sql` only while the application is still in maintenance/read-only mode and before new writes are accepted into the target tenant/workspace. If any row-count precondition fails, stop and use database restore or a manually reviewed recovery script.

Rollback evidence must include:
- the pre-migration dry-run report
- the generated bundle manifest
- the exact `apply.sql` and `rollback.sql` reviewed for the write migration
- a database backup identifier
- a restore rehearsal result or approved rollback plan
- the post-rollback tenant-isolation audit command and result

## Post-Migration Verification

After any write migration:

```bash
npm run audit:tenant-isolation -- --mode=external_launch --output=.launch-evidence/tenant-isolation/post-backfill-audit.json
```

Launch cannot proceed while the audit reports blockers, orphaned rows, cross-tenant references, unscoped identity rows, or remaining `primary` bridge rows.
