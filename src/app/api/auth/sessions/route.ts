import { z } from "zod";
import {
  getSessionUser,
  listUserSessions,
  revokeSessionForUser
} from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";

const revokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
  reason: z.string().min(1).max(200).optional().default("user_revoked")
});

function homeTenantIdFor(user: { tenant_id: string; real_tenant_id: string }) {
  return user.real_tenant_id || user.tenant_id;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessions = await listUserSessions(user);
  return Response.json({ sessions });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = revokeSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const revoked = await revokeSessionForUser({
    sessionId: parsed.data.sessionId,
    user,
    reason: parsed.data.reason
  });
  if (!revoked) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantId: homeTenantIdFor(user),
    actorUserId: user.id,
    action: "auth_session_revoked",
    entityType: "auth_session",
    entityId: parsed.data.sessionId,
    data: {
      reason: parsed.data.reason
    }
  });

  return Response.json({ status: "revoked" });
}
