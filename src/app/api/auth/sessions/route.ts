import { z } from "zod";
import {
  getSessionContext,
  listUserSessions,
  revokeSessionForUser
} from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";

const revokeSessionSchema = z.object({
  sessionId: z.string().uuid()
});

export async function GET() {
  const context = await getSessionContext();
  if (!context) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessions = await listUserSessions(context.user);
  return Response.json({
    sessions: sessions.map((session) => ({
      ...session,
      current: session.id === context.sessionId
    }))
  });
}

export async function DELETE(request: Request) {
  const context = await getSessionContext();
  if (!context) {
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
    return Response.json({ error: "Invalid session id" }, { status: 400 });
  }

  const revoked = await revokeSessionForUser({
    sessionId: parsed.data.sessionId,
    user: context.user,
    reason: "user_revoked"
  });

  if (!revoked) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantKey: context.user.tenant_key,
    workspaceKey: context.user.workspace_key,
    actorUserId: context.user.id,
    action: "auth_session_revoked",
    entityType: "auth_session",
    entityId: parsed.data.sessionId,
    data: {
      current: parsed.data.sessionId === context.sessionId
    }
  });

  return Response.json({
    status: "ok",
    current: parsed.data.sessionId === context.sessionId
  });
}
