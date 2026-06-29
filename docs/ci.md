# CI And Release Gate

This repository uses GitHub Actions as the pre-merge and main-branch release gate for local-code evidence.
Provider dashboards, Cloudflare Access policy enforcement, R2 bucket checks, OAuth smoke tests, and production telemetry remain deployment evidence and must be verified during rollout.

## Workflows

- `.github/workflows/ci.yml`
  - Runs on pull requests to `main`, pushes to `main`, pushes to `recovery/v2-retain-all-work`, and manual dispatch.
  - Executes `npm run typecheck`, `npm run lint`, `npm test`, `npm run audit:security`, `npm run build:web`, and `npm run build:backoffice`.
  - Uses pinned GitHub Actions and safe placeholder CI environment variables so production env validation is exercised without real secrets.
- `.github/workflows/tenant-isolation.yml`
  - Runs the v2 tenant-isolation regression gate with `npm run test:tenant-isolation`.
- `.github/workflows/ai-safety.yml`
  - Runs the AI safety gate with `npm run test:ai-safety`.

## Required Branch Protection

Before production launch, protect `main` so the following checks must pass before merge:

- `Production CI Gate / Typecheck, lint, test, and audit`
- `Production CI Gate / Build web service`
- `Production CI Gate / Build backoffice service`
- `Tenant Isolation Gate / Tenant isolation regression suite`
- `AI Safety Gate / Typecheck and red-team suite`

Also require at least one human review for changes touching:

- `src/server/**`
- `src/app/api/**`
- `apps/backoffice/**`
- `db/migrations/**`
- `packages/auth/**`
- `packages/database/**`
- `.github/workflows/**`

## Release Candidate Checklist

Run the same gate locally before tagging or deploying a release candidate:

```bash
npm run typecheck
npm run lint
npm test
npm run audit:security
npm run build:web
npm run build:backoffice
git diff --check
```

The local gate proves code, tests, and builds only. It does not prove deployed provider credentials, provider dashboards, Cloudflare Access policies, R2 bucket policy/versioning, production telemetry, or backup restore evidence.
Production env validation does require a `SECURITY_ALERT_WEBHOOK` so security-sensitive events have a configured alert destination before launch. The CI workflow uses a placeholder URL only to validate the contract; real deploys must use the production alert sink.

## Rollback Stance

Code rollback should be a standard revert or redeploy of the previous known-good commit from `main`.
Schema rollback is not assumed safe by default: migrations must be reviewed before deployment, and destructive migrations require a backup plus an explicit rollback or forward-fix plan.

Before any production deployment:

1. Confirm the last successful `Production CI Gate` run for the commit being deployed.
2. Confirm database backup freshness and restore ownership.
3. Confirm any migration has a reviewed forward-fix or rollback plan.
4. Confirm provider webhook secrets and callback URLs match the target environment.
5. Confirm release owner, incident commander, and rollback owner are assigned.
