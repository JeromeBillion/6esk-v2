-- 6esk v2: tenant-owned merge review tasks.
-- Existing review tasks are backfilled from their referenced ticket/customer rows,
-- falling back to the seeded default tenant only when legacy rows have no owner.

ALTER TABLE merge_review_tasks
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE merge_review_tasks mrt
SET tenant_id = COALESCE(scope.tenant_id, '00000000-0000-0000-0000-000000000001')
FROM (
  SELECT
    task.id,
    COALESCE(
      context_ticket.tenant_id,
      source_ticket.tenant_id,
      target_ticket.tenant_id,
      source_customer.tenant_id,
      target_customer.tenant_id
    ) AS tenant_id
  FROM merge_review_tasks task
  LEFT JOIN tickets context_ticket ON context_ticket.id = task.ticket_id
  LEFT JOIN tickets source_ticket ON source_ticket.id = task.source_ticket_id
  LEFT JOIN tickets target_ticket ON target_ticket.id = task.target_ticket_id
  LEFT JOIN customers source_customer ON source_customer.id = task.source_customer_id
  LEFT JOIN customers target_customer ON target_customer.id = task.target_customer_id
) scope
WHERE scope.id = mrt.id
  AND mrt.tenant_id IS NULL;

ALTER TABLE merge_review_tasks
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_merge_review_tasks_tenant_status_created_at
  ON merge_review_tasks(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_merge_review_tasks_tenant_ticket_id
  ON merge_review_tasks(tenant_id, ticket_id);

CREATE INDEX IF NOT EXISTS idx_merge_review_tasks_tenant_source_ticket_id
  ON merge_review_tasks(tenant_id, source_ticket_id);

CREATE INDEX IF NOT EXISTS idx_merge_review_tasks_tenant_target_ticket_id
  ON merge_review_tasks(tenant_id, target_ticket_id);

CREATE INDEX IF NOT EXISTS idx_merge_review_tasks_tenant_source_customer_id
  ON merge_review_tasks(tenant_id, source_customer_id);

CREATE INDEX IF NOT EXISTS idx_merge_review_tasks_tenant_target_customer_id
  ON merge_review_tasks(tenant_id, target_customer_id);
