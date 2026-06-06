import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets } from "@/server/auth/roles";
import {
  getVoiceOperatorPresence,
  upsertVoiceOperatorPresence,
  VOICE_OPERATOR_STATUSES
} from "@/server/calls/operators";
import { isWorkspaceModuleEnabled } from "@/server/workspace-modules";
import { tenantScopeFromUser } from "@/server/tenant-context";

const updatePresenceSchema = z.object({
  status: z.enum(VOICE_OPERATOR_STATUSES).optional(),
  activeCallSessionId: z.string().uuid().nullable().optional(),
  registered: z.boolean().optional()
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const scope = tenantScopeFromUser(user);
  const voiceEnabled = await isWorkspaceModuleEnabled("voice", scope.workspaceKey, scope.tenantKey);
  const presence = await getVoiceOperatorPresence(user.id, scope);
  return Response.json({
    voiceEnabled,
    presence
  });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const scope = tenantScopeFromUser(user);
  if (!(await isWorkspaceModuleEnabled("voice", scope.workspaceKey, scope.tenantKey))) {
    return Response.json(
      {
        error: "Voice module is not enabled for this workspace.",
        code: "module_disabled",
        module: "voice"
      },
      { status: 409 }
    );
  }

  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = updatePresenceSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const current = await getVoiceOperatorPresence(user.id, scope);
  const next = await upsertVoiceOperatorPresence({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    userId: user.id,
    status: parsed.data.status ?? current.status,
    activeCallSessionId:
      parsed.data.activeCallSessionId === undefined
        ? current.activeCallSessionId
        : parsed.data.activeCallSessionId,
    registered: parsed.data.registered
  });

  return Response.json({ presence: next });
}
