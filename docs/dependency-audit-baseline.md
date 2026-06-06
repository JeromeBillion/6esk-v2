# Dependency Audit Baseline

Last updated: May 10, 2026

## Policy

- CI/release gate: `npm run audit:security`
- Full review command: `npm run audit:full`
- High or critical production dependency advisories must be remediated before launch.
- Moderate dev-tool advisories may remain only with a tracked upgrade decision and no production exposure.

## Current Baseline

`npm audit fix` was run without `--force`.

Closed:

- `fast-xml-builder` high advisory via lockfile update to `fast-xml-builder@1.2.0`
- `next` lockfile update to `15.5.18`

Remaining `npm audit` output:

- 0 critical
- 0 high
- 7 moderate

Remaining moderate items:

- `vitest` -> `vite` / `vite-node` / `@vitest/mocker` / `esbuild`
  - Scope: test/dev tooling.
  - Fix path: upgrade `vitest` to `4.1.5`, which is semver-major and must be tested separately.
  - Current decision: defer to a dedicated test-tooling upgrade PR.
- `next` -> bundled `postcss@8.4.31`
  - Scope: framework transitive dependency reported by npm audit.
  - NPM's suggested fix path incorrectly points to a major downgrade (`next@9.3.3`), so do not apply `npm audit fix --force`.
  - Current decision: track upstream Next remediation and keep `next` on patched stable releases.

## Remediation Workflow

1. Run `npm run audit:security` before every release candidate.
2. If high or critical advisories appear, stop the release and patch or replace the dependency.
3. Run `npm run audit:full` weekly and before dependency upgrade branches.
4. For semver-major fixes, create a dedicated branch with full `npm test` and `npm run build`.
5. Record any accepted residual risk in this file and the v2 roadmap.
