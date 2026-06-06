-- 6esk v2: v2-native Google/Microsoft auth login adapter.
-- This keeps users/auth_sessions as source of truth while allowing managed OAuth SSO.

ALTER TABLE tenant_security_policies
  DROP CONSTRAINT IF EXISTS tenant_security_policies_auth_provider_check;

ALTER TABLE tenant_security_policies
  ADD CONSTRAINT tenant_security_policies_auth_provider_check
  CHECK (auth_provider IN ('password', 'oauth', 'better_auth', 'oidc_broker'));

ALTER TABLE auth_mfa_challenges
  ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'password_mfa';

