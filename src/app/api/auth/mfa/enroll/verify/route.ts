import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { verifyTotpEnrollment } from "@/server/auth/mfa";
import { recordAuditLog } from "@/server/audit";

const verifyEnrollmentSchema = z.object({
  enrollmentToken: z.string().min(16),
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

  const parsed = verifyEnrollmentSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid MFA enrollment" }, { status: 400 });
  }

  const verification = await verifyTotpEnrollment({
    user,
    enrollmentToken: parsed.data.enrollmentToken,
    code: parsed.data.code
  });

  if (!verification.ok) {
    await recordAuditLog({
      tenantKey: user.tenant_key,
      workspaceKey: user.workspace_key,
      actorUserId: user.id,
      action: "auth_mfa_enrollment_failed",
      entityType: "auth_mfa_factor",
      data: { code: verification.code }
    }).catch(() => {});
    return Response.json(
      {
        error: verification.code === "invalid_code" ? "Invalid MFA code" : "Invalid MFA enrollment",
        code: verification.code
      },
      { status: 401 }
    );
  }

  await recordAuditLog({
    tenantKey: user.tenant_key,
    workspaceKey: user.workspace_key,
    actorUserId: user.id,
    action: "auth_mfa_enrollment_verified",
    entityType: "auth_mfa_factor",
    entityId: verification.factorId,
    data: { factorType: "totp" }
  }).catch(() => {});

  return Response.json({ status: "ok", factorId: verification.factorId });
}
