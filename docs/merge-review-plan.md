# 6esk Merge Review Plan

## Scope
This plan covers merge-readiness checks for `6esk`, including **all DB migrations required for this merge**.

## Migration Plan
Run:

```powershell
npm run db:migrate
```

The migrator is incremental (`schema_migrations`), so:
- On environments already at `origin/main`, this merge adds: `0016_external_user_links.sql`.
- On fresh databases, all migrations below are required.

## Full Migration Inventory (Required)
1. `db/migrations/0001_init.sql`
2. `db/migrations/0002_ticket_message_link.sql`
3. `db/migrations/0003_ticket_tags_macros.sql`
4. `db/migrations/0004_ticket_analytics_indexes.sql`
5. `db/migrations/0005_ai_agent_integration.sql`
6. `db/migrations/0006_agent_policy.sql`
7. `db/migrations/0007_inbound_events.sql`
8. `db/migrations/0008_spam_rules.sql`
9. `db/migrations/0009_inbound_alerts.sql`
10. `db/migrations/0010_message_flags.sql`
11. `db/migrations/0011_whatsapp_scaffold.sql`
12. `db/migrations/0012_whatsapp_outbox_retry.sql`
13. `db/migrations/0013_whatsapp_templates.sql`
14. `db/migrations/0014_whatsapp_status_events.sql`
15. `db/migrations/0015_agent_draft_metadata.sql`
16. `db/migrations/0015_inbound_alert_configs.sql`
17. `db/migrations/0016_external_user_links.sql` (**new in this merge**)

## Verification
After migration:

```sql
SELECT filename FROM schema_migrations ORDER BY filename;
```

Expected:
- Existing env upgrade: includes `0016_external_user_links.sql`.
- Fresh env: includes all files listed in this plan.

