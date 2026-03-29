# Docs

This directory is intentionally compact and only keeps implementation-critical docs.

## Keep
- `docs/figma-ai-crm-ui-target-state.md`
  - Frontend product/UX target-state spec for the CRM/support UI
- `docs/frontend-ui-system.md`
  - Current frontend implementation guide: styling, shared interaction rules, branding, theme, demo mode, and route ownership
- `docs/email-setup.md`
  - Current email runbook and payload contracts (`/api/email/inbound`, `/api/email/send`, `/api/tickets/create`)
- `docs/platform-support-requirements.md`
  - Platform (`6ex`) to `6esk` support ticket integration contract
- `docs/merge-feature-roadmap.md`
  - Current customer identity, customer history, and merge behavior/spec
- `docs/webagent-escalation-dependencies.md`
  - Cross-repo env/secret map for prediction backend, Venus runtime, and 6esk
- `docs/call-capabilities-plan.md`
  - Inbound/outbound voice capability roadmap and implementation phases
- `docs/call-capabilities-backlog.md`
  - Ticketized execution backlog with dependencies, estimates, and sprint cut
- `docs/call-ops-runbook.md`
  - Call operations runbook (replay drill, outbox load/retry drill, rollback)
- `docs/call-crm-staging-e2e.md`
  - Staging E2E harness for CRM call orchestration checklist validation
- `docs/privacy-retention-policy.md`
  - Voice consent source-of-truth and recording/transcript retention wording
- `docs/voice-pilot-runbook.md`
  - Current pilot/rollout checklist for the voice feature
- `docs/Venus-Voice.md`
  - Venus-to-6esk AI voice integration contract and safety model
- `docs/6esk-v1-completion-roadmap.md`
  - Completion roadmap for the `6ex`-custom proprietary `6esk v1` product
- `docs/6esk-v1-execution-backlog.md`
  - Ordered execution backlog translating the `v1` roadmap into concrete implementation slices
- `docs/6esk-v2-commercialization-roadmap.md`
  - Multi-tenant SaaS commercialization roadmap for `6esk v2`, including South Africa readiness and BizOps

## Culled
Removed as stale/duplicative:
- `docs/email-payload.md`
- `docs/merge-review-plan.md`
- `docs/PRD.md`
- `docs/R&D.md`
- `docs/roadmap.md`
- `docs/VOICE-075-pilot-runbook.md`
- `docs/ui-overhaul-roadmap.md`
- `EXPLORATION_FINDINGS.md`
- `Landing/`
- `New 6esk UI/`
