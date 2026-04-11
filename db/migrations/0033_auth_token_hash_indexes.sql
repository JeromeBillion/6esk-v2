-- 0033: Add missing B-tree indexes on token_hash columns.
--
-- The auth_sessions and password_resets tables are queried by token_hash
-- on every authenticated request and password reset flow respectively.
-- Without these indexes, lookups degrade to sequential scans as the
-- tables grow, causing severe latency on login and session validation.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_sessions_token_hash
  ON auth_sessions (token_hash);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_password_resets_token_hash
  ON password_resets (token_hash);
