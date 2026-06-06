# 6esk v2

Multi-tenant B2B SaaS support platform with native AI orchestration.

Forked from [6esk v1](https://github.com/JeromeBillion/6esk) — see `docs/6esk-v2-commercialization-roadmap.md` for the full v2 roadmap.

## What's New in v2

- **Native Dexter module** (`src/dexter/`) — AI orchestration agent forked from Venus, now a first-party 6esk module
- Multi-tenant architecture foundation
- Module entitlements and metering
- BYO AI provider mode support

## Quick Start

```bash
npm install
npm run dev
```

## Environment

Copy `.env.example` to `.env` and fill in the values.

## Database Migrations

```bash
npm run db:migrate
```

## Dexter Module

The `src/dexter/` directory contains the native AI orchestration module, ported from the external Venus ElizaOS project. It includes:

- **Characters** — Channel-specific agent personalities (webchat, CRM, Twitter, WhatsApp)
- **Plugins** — CRM bridge, escalation, WhatsApp, routing telemetry
- **Reliability** — Loop breaker, run-state management
- **Security** — Route scoping, trusted upstream telemetry
- **Startup gates** — Environment validation and readiness checks

Dexter channel agents are controlled via env toggles:
- `DEXTER_ENABLE_CRM_AGENT`
- `DEXTER_ENABLE_TWITTER_AGENT`
- `DEXTER_ENABLE_WHATSAPP_AGENT`
- `DEXTER_ENABLE_ESCALATION_BRIDGE`

## Docs

See `docs/` for roadmaps and integration guides.
