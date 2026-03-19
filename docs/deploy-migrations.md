# Deploy Migrations

All deploy-time schema migrations are in:

- `db/migrations/*.sql`

They are applied in filename order by:

- `scripts/migrate.js`

Run:

```bash
npm run db:migrate
```

Notes:

- Applied migrations are tracked in the `schema_migrations` table.
- New migration added for saved views:
  - `db/migrations/0023_support_saved_views.sql`
