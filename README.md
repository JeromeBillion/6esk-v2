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

## Sign In

Visit `http://localhost:3000/login` and use the Lead Admin credentials.

## Health Check

Visit `http://localhost:3000/api/health`.

## Email API

Inbound/outbound payload specs are documented in `docs/email-payload.md`.
