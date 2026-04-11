-- 0034: Use citext for case-insensitive customer email lookups.
--
-- The existing LOWER(primary_email) functional index only works when
-- queries explicitly wrap the column in LOWER(). Switching to citext
-- makes all comparisons case-insensitive natively, so queries like
-- WHERE primary_email = 'User@Example.com' hit the index without
-- requiring LOWER() in every call site.

CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE customers
  ALTER COLUMN primary_email TYPE citext;

-- Replace the old functional index with a plain B-tree on the citext column.
-- citext comparisons are inherently case-insensitive, so LOWER() is no longer needed.
DROP INDEX IF EXISTS idx_customers_primary_email;
CREATE INDEX idx_customers_primary_email ON customers (primary_email);
