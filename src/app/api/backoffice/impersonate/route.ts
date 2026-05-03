import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { cookies } from "next/headers";
import crypto from "crypto";

const impersonateSchema = z.object({
  tenantId: z.string().uuid()
});

function hashToken(token: string) {
  const secret = process.env.SESSION_SECRET ?? "";
  return crypto.createHash("sha256").update(`${token}:${secret}`).digest("hex");
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = impersonateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const targetTenantId = parsed.data.tenantId;

  // Validate tenant exists
  const tenantResult = await db.query("SELECT id FROM tenants WHERE id = $1 LIMIT 1", [targetTenantId]);
  if (tenantResult.rows.length === 0) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  // Get current session token
  const cookieName = process.env.SESSION_COOKIE_NAME ?? "sixesk_session";
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;

  if (!token) {
    return Response.json({ error: "No active session" }, { status: 401 });
  }

  const tokenHash = hashToken(token);

  await db.query(
    `UPDATE auth_sessions SET impersonated_tenant_id = $1 WHERE token_hash = $2`,
    [targetTenantId, tokenHash]
  );

  // Critical: Audit log the break-glass action
  await recordAuditLog({
    tenantId: targetTenantId, // Log it in the target tenant's audit trail!
    actorUserId: user!.id,
    action: "support_impersonation_started",
    entityType: "tenant",
    entityId: targetTenantId,
    data: { reason: "Internal support request" } // A real implementation might require a JIRA ticket ID
  });

  return Response.json({ status: "impersonating", tenantId: targetTenantId });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user || !user.is_impersonating) {
    return Response.json({ status: "not_impersonating" });
  }

  const cookieName = process.env.SESSION_COOKIE_NAME ?? "sixesk_session";
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;

  if (!token) {
    return Response.json({ error: "No active session" }, { status: 401 });
  }

  const tokenHash = hashToken(token);

  const previousTenantId = user.tenant_id;

  await db.query(
    `UPDATE auth_sessions SET impersonated_tenant_id = NULL WHERE token_hash = $1`,
    [tokenHash]
  );

  await recordAuditLog({
    tenantId: previousTenantId,
    actorUserId: user.id,
    action: "support_impersonation_ended",
    entityType: "tenant",
    entityId: previousTenantId,
    data: {}
  });

  return Response.json({ status: "impersonation_ended" });
}
