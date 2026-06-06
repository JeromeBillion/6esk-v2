import { getSessionUser } from "@/server/auth/session";
import { canManageTickets } from "@/server/auth/roles";
import { createDeskVoiceAccessToken } from "@/server/calls/voice-client";
import { getVoiceOperatorPresence } from "@/server/calls/operators";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = user.tenant_id;
  if (!tenantId) {
    return Response.json({ error: "Tenant missing" }, { status: 403 });
  }
  if (!(await checkModuleEntitlement("voice", tenantId))) {
    return Response.json(
      {
        error: "Voice module is not enabled for this workspace.",
        code: "module_disabled",
        module: "voice"
      },
      { status: 409 }
    );
  }

  try {
    const token = createDeskVoiceAccessToken(user.id);
    const presence = await getVoiceOperatorPresence(user.id);
    return Response.json({
      identity: token.identity,
      accessToken: token.token,
      expiresInSeconds: token.expiresInSeconds,
      presence
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to create Twilio client token.";
    return Response.json({ error: "Voice client is not configured.", detail }, { status: 503 });
  }
}
