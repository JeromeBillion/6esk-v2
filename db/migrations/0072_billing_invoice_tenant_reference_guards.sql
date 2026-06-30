-- Enforce tenant/workspace ownership for invoice-linked billing records.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_invoices_tenant_workspace_id
  ON tenant_invoices (tenant_id, workspace_key, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_invoice_lines_invoice_scope_fk'
  ) THEN
    ALTER TABLE tenant_invoice_lines
      ADD CONSTRAINT tenant_invoice_lines_invoice_scope_fk
      FOREIGN KEY (tenant_id, workspace_key, invoice_id)
      REFERENCES tenant_invoices (tenant_id, workspace_key, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_billing_adjustments_source_invoice_scope_fk'
  ) THEN
    ALTER TABLE tenant_billing_adjustments
      ADD CONSTRAINT tenant_billing_adjustments_source_invoice_scope_fk
      FOREIGN KEY (tenant_id, workspace_key, source_invoice_id)
      REFERENCES tenant_invoices (tenant_id, workspace_key, id)
      ON DELETE SET NULL (source_invoice_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_billing_adjustments_applied_invoice_scope_fk'
  ) THEN
    ALTER TABLE tenant_billing_adjustments
      ADD CONSTRAINT tenant_billing_adjustments_applied_invoice_scope_fk
      FOREIGN KEY (tenant_id, workspace_key, applied_invoice_id)
      REFERENCES tenant_invoices (tenant_id, workspace_key, id)
      ON DELETE SET NULL (applied_invoice_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_collection_events_invoice_scope_fk'
  ) THEN
    ALTER TABLE tenant_collection_events
      ADD CONSTRAINT tenant_collection_events_invoice_scope_fk
      FOREIGN KEY (tenant_id, workspace_key, invoice_id)
      REFERENCES tenant_invoices (tenant_id, workspace_key, id)
      ON DELETE SET NULL (invoice_id);
  END IF;
END $$;
