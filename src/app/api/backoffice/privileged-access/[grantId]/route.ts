import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { INTERNAL_ADMIN_ROLE, isInternalStaff } from "@/server/auth/roles";
import {
  approvePrivilegedAccessGrant,
  hasPrivilegedMfaSession,
  reviewPrivilegedAccessGrant,
  revokePrivilegedAccessGrant
} from "@/server/auth/privileged-access";
import { sendPrivilegedAccessAlert } from "@/server/auth/privileged-access-alerts";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    tenantId: z.string().uuid(),
    approvalNote: z.string().max(1000).optional().nullable()
  }),
  z.object({
    action: z.literal("revoke"),
    tenantId: z.string().uuid(),
    revokeReason: z.string().trim().min(4).max(1000)
  }),
  z.object({
    action: z.literal("review"),
    tenantId: z.string().uuid(),
    reviewNote: z.string().trim().min(8).max(1000)
  })
]);

function isInternalAdmin(user: { role_name?: string | null } | null) {
  return user?.role_name === INTERNAL_ADMIN_ROLE;
}

async function requireInternalAdminWithMfa() {
  const user = await getSessionUser();
  if (!isInternalStaff(user) || !isInternalAdmin(user)) {
    return {
      ok: false as const,
      response: Response.json({ error: "Forbidden. Internal admin only." }, { status: 403 })
    };
  }
  if (!hasPrivilegedMfaSession(user)) {
    return {
      ok: false as const,
      response: Response.json({ error: "MFA is required for privileged access." }, { status: 403 })
    };
  }
  return { ok: true as const, user: user! };
}

export async function POST(request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  const auth = await requireInternalAdminWithMfa();
  if (!auth.ok) return auth.response;

  const { grantId } = await params;
  const grantIdResult = z.string().uuid().safeParse(grantId);
  if (!grantIdResult.success) {
    return Response.json({ error: "Invalid grant id" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const scope = { tenantId: parsed.data.tenantId, workspaceKey: DEFAULT_WORKSPACE_KEY };

  try {
    if (parsed.data.action === "approve") {
      const grant = await approvePrivilegedAccessGrant(
        scope,
        grantIdResult.data,
        auth.user.id,
        parsed.data.approvalNote
      );
      await sendPrivilegedAccessAlert({
        scope: { tenantId: parsed.data.tenantId, workspaceKey: DEFAULT_WORKSPACE_KEY },
        grant,
        event: "approved",
        actorUserId: auth.user.id
      });
      return Response.json({ grant });
    }

    if (parsed.data.action === "revoke") {
      const grant = await revokePrivilegedAccessGrant(
        scope,
        grantIdResult.data,
        auth.user.id,
        parsed.data.revokeReason
      );
      await sendPrivilegedAccessAlert({
        scope: { tenantId: parsed.data.tenantId, workspaceKey: DEFAULT_WORKSPACE_KEY },
        grant,
        event: "revoked",
        actorUserId: auth.user.id
      });
      return Response.json({ grant });
    }

    const grant = await reviewPrivilegedAccessGrant(
      scope,
      grantIdResult.data,
      auth.user.id,
      parsed.data.reviewNote
    );
    return Response.json({ grant });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
