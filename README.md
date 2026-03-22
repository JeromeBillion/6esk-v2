# 6esk

Lightweight support platform with a first‑class, two‑way email system.

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

## Seed Lead Admin

```bash
node scripts/seed-admin.js
```

This seeds:
- Lead Admin user
- `support@6ex.co.za` platform mailbox
- `jerome.choma@6ex.co.za` personal mailbox
- Default support tags and macros

## Sign In

Visit `http://localhost:3000/login` and use the Lead Admin credentials.

## Health Check

Visit `http://localhost:3000/api/health`.

## Docs

Primary docs index: `docs/README.md`.

Frontend UI/design-system guide: `docs/frontend-ui-system.md`.
