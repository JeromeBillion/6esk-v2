# Tenant Query Scope Sweep Runbook

## Purpose

The tenant query-scope sweep is a static, read-only launch gate for API, server, and worker SQL. It looks for direct query calls that touch known tenant/workspace-owned tables without `tenant_key` evidence in the query text.

This does not replace a central repository boundary, row-level security, or runtime authorization. It turns the remaining manual tenant-scope review into repeatable evidence while those stronger controls are being completed.

## Run

```powershell
npm run audit:tenant-query-scope
```

The command scans:

- `src/app/api`
- `src/server`
- `scripts`

It writes JSON evidence under `.launch-evidence/tenant-query-scope/` and exits non-zero when blocker findings exist.

For a focused sweep:

```powershell
node scripts/tenant-query-scope-sweep.js --evidence-dir .launch-evidence/tenant-query-scope --root=src/server/calls --root=src/app/api/admin/calls
```

For triage without failing the shell:

```powershell
node scripts/tenant-query-scope-sweep.js --evidence-dir .launch-evidence/tenant-query-scope --fail-on=never --json
```

## Finding Policy

A blocker means a query references a tenant-scoped table and the query call does not contain `tenant_key`. Treat every blocker as launch-blocking until one of these is true:

- the query is fixed to scope by tenant, and workspace where required
- the query is intentionally cross-tenant lead-admin or operator evidence and has explicit authorization plus audit logging
- the query is a maintenance-only migration/backfill path with a documented runbook and rollback

Intentional global reads can be suppressed next to the query:

```ts
// tenant-scope-sweep: ignore lead-admin cross-tenant inventory
await db.query("SELECT id FROM users WHERE id = $1", [userId]);
```

Suppressions must include a reason and should stay rare.

## Evidence Review

Each report includes:

- `ready`
- `writesDatabase: false`
- scanned roots and file/query counts
- blocker count and recorded findings
- suppressed query list
- scoped table inventory used by the static analyzer

Before launch, archive a passing report for every production release candidate, plus the database tenant isolation audit and provider-routing rehearsal artifacts.

## Limitations

This is conservative static analysis. It cannot prove dynamic SQL or repository helper behavior is safe, and it only checks for `tenant_key` evidence in the query call. The remaining production hardening target is still mechanical enforcement through a central query boundary or row-level security strategy.
