-- 6esk v2: tenant-scope customer identity uniqueness.
--
-- The original CRM merge foundation predated first-class tenants and made
-- external customer references and email/phone identities globally unique.
-- In SaaS mode, separate tenants must be able to hold the same customer email,
-- phone number, or upstream customer id without blocking each other.

DROP INDEX IF EXISTS uq_customers_external_identity;

ALTER TABLE customer_identities
  DROP CONSTRAINT IF EXISTS customer_identities_identity_type_identity_value_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_external_identity
  ON customers (tenant_id, external_system, external_user_id)
  WHERE external_system IS NOT NULL AND external_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_identities_tenant_identity
  ON customer_identities (tenant_id, identity_type, identity_value);
