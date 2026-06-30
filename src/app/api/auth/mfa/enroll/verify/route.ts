import { z } from "zod";
import {
  completedMfaEnrollmentAuthProvider,
  getSessionUser,
  updateCurrentSessionAuthProvider
} from "@/server/auth/session";
import { verifyTotpEnrollment } from "@/server/auth/mfa";
import { recordAuditLog } from "@/server/audit";

const verifySchema = z.object({
  enrollmentToken: z.string().min(1),
  code: z.string().min(1)
});

export async function POST(request: Request) {
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

  const parsed = verifySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid MFA enrollment" }, { status: 400 });
  }

  const result = await verifyTotpEnrollment({
    user,
    enrollmentToken: parsed.data.enrollmentToken,
    code: parsed.data.code
  });

  if (!result.ok) {
    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "auth_mfa_enrollment_failed",
      entityType: "auth_mfa_enrollment",
      data: { reason: result.code }
    });
    return Response.json({ error: "Invalid MFA enrollment", code: result.code }, { status: 401 });
  }

  const upgradedAuthProvider = completedMfaEnrollmentAuthProvider(user.session_auth_provider);
  const sessionUpgraded = upgradedAuthProvider
    ? await updateCurrentSessionAuthProvider({
        user,
        authProvider: upgradedAuthProvider
      })
    : false;

  await recordAuditLog({
    tenantId: user.tenant_id,
    actorUserId: user.id,
    action: "auth_mfa_enrollment_verified",
    entityType: "auth_mfa_factor",
    entityId: result.factorId,
    data: {
      factorType: "totp",
      sessionAuthProvider: upgradedAuthProvider,
      sessionUpgraded
    }
  });

  return Response.json({ status: "ok", factorId: result.factorId });
}
