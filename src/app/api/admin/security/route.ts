import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { getBetterAuthReadiness } from "@/server/auth/better-auth-readiness";
import { db } from "@/server/db";

function parseAllowlist(value?: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? null;
  }
  const realIp = request.headers.get("x-real-ip");
  return realIp?.trim() ?? null;
}

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;
  const { scope } = access;

  const adminAllowlist = parseAllowlist(process.env.ADMIN_IP_ALLOWLIST);
  const agentAllowlist = parseAllowlist(process.env.AGENT_IP_ALLOWLIST);
  const agentSecretKeyConfigured = Boolean(process.env.AGENT_SECRET_KEY);
  const inboundSecretConfigured = Boolean(process.env.INBOUND_SHARED_SECRET);

  const agentStatsRes = await db.query<{
    total: number;
    encrypted: number;
  }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE shared_secret LIKE 'enc:v1:%')::int AS encrypted
     FROM agent_integrations
     WHERE tenant_key = $1
       AND workspace_key = $2`,
    [scope.tenantKey, scope.workspaceKey]
  );
  const agentStats = agentStatsRes.rows[0] ?? { total: 0, encrypted: 0 };
  const agentUnencrypted = Math.max(0, agentStats.total - agentStats.encrypted);

  const whatsappStatsRes = await db.query<{
    total_tokens: number;
    encrypted_tokens: number;
    missing_tokens: number;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE access_token IS NOT NULL AND access_token <> '')::int AS total_tokens,
        COUNT(*) FILTER (WHERE access_token LIKE 'enc:v1:%')::int AS encrypted_tokens,
        COUNT(*) FILTER (WHERE access_token IS NULL OR access_token = '')::int AS missing_tokens
     FROM whatsapp_accounts
     WHERE tenant_key = $1
       AND workspace_key = $2`,
    [scope.tenantKey, scope.workspaceKey]
  );
  const whatsappStats = whatsappStatsRes.rows[0] ?? {
    total_tokens: 0,
    encrypted_tokens: 0,
    missing_tokens: 0
  };
  const whatsappUnencrypted = Math.max(0, whatsappStats.total_tokens - whatsappStats.encrypted_tokens);

  const mfaStatsRes = await db.query<{
    active_factors: number;
    privileged_users: number;
    privileged_users_missing_mfa: number;
  }>(
    `WITH active_totp AS (
       SELECT DISTINCT user_id
       FROM auth_mfa_factors
       WHERE tenant_key = $1
         AND workspace_key = $2
         AND factor_type = 'totp'
         AND disabled_at IS NULL
     )
     SELECT
       (
         SELECT COUNT(*)::int
         FROM auth_mfa_factors
         WHERE tenant_key = $1
           AND workspace_key = $2
           AND disabled_at IS NULL
       ) AS active_factors,
       COUNT(*) FILTER (WHERE r.name = 'lead_admin')::int AS privileged_users,
       COUNT(*) FILTER (WHERE r.name = 'lead_admin' AND active_totp.user_id IS NULL)::int
         AS privileged_users_missing_mfa
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     LEFT JOIN active_totp ON active_totp.user_id = u.id
     WHERE u.tenant_key = $1
       AND u.workspace_key = $2
       AND u.is_active = true`,
    [scope.tenantKey, scope.workspaceKey]
  );
  const mfaStats = mfaStatsRes.rows[0] ?? {
    active_factors: 0,
    privileged_users: 0,
    privileged_users_missing_mfa: 0
  };

  return Response.json({
    adminAllowlist,
    agentAllowlist,
    agentSecretKeyConfigured,
    inboundSecretConfigured,
    clientIp: getClientIp(request),
    agentIntegrationStats: {
      total: agentStats.total,
      encrypted: agentStats.encrypted,
      unencrypted: agentUnencrypted
    },
    whatsappTokenStats: {
      total: whatsappStats.total_tokens,
      encrypted: whatsappStats.encrypted_tokens,
      unencrypted: whatsappUnencrypted,
      missing: whatsappStats.missing_tokens
    },
    mfaStats: {
      activeFactors: mfaStats.active_factors,
      privilegedUsers: mfaStats.privileged_users,
      privilegedUsersMissingMfa: mfaStats.privileged_users_missing_mfa
    },
    authIdentity: getBetterAuthReadiness()
  });
}
