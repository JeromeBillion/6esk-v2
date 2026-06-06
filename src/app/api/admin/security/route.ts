import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
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
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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
     FROM agent_integrations`
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
     FROM whatsapp_accounts`
  );
  const whatsappStats = whatsappStatsRes.rows[0] ?? {
    total_tokens: 0,
    encrypted_tokens: 0,
    missing_tokens: 0
  };
  const whatsappUnencrypted = Math.max(0, whatsappStats.total_tokens - whatsappStats.encrypted_tokens);

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
    }
  });
}
