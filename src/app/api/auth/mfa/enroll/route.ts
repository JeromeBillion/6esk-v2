import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { getMfaStatusForUser, startTotpEnrollment } from "@/server/auth/mfa";
import { recordAuditLog } from "@/server/audit";

const enrollmentSchema = z.object({
  label: z.string().max(120).optional()
});

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getMfaStatusForUser(user);
  return Response.json(status);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parsed = enrollmentSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid MFA enrollment request" }, { status: 400 });
  }

  const enrollment = await startTotpEnrollment({
    user,
    label: parsed.data.label
  });

  await recordAuditLog({
    tenantKey: user.tenant_key,
    workspaceKey: user.workspace_key,
    actorUserId: user.id,
    action: "auth_mfa_enrollment_started",
    entityType: "auth_mfa_factor",
    data: {
      factorType: "totp"
    }
  }).catch(() => {});

  return Response.json({
    enrollmentToken: enrollment.enrollmentToken,
    otpauthUrl: enrollment.otpauthUrl,
    secretBase32: enrollment.secretBase32,
    expiresAt: enrollment.expiresAt
  });
}
