import { z } from "zod";
import { createSession } from "@/server/auth/session";
import { verifyMfaChallenge } from "@/server/auth/mfa";
import { recordAuditLog } from "@/server/audit";

const challengeSchema = z.object({
  challengeToken: z.string().min(16),
  code: z.string().min(1)
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = challengeSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid MFA challenge" }, { status: 400 });
  }

  const verification = await verifyMfaChallenge(parsed.data);
  if (!verification.ok) {
    if (verification.tenantKey && verification.workspaceKey && verification.userId) {
      await recordAuditLog({
        tenantKey: verification.tenantKey,
        workspaceKey: verification.workspaceKey,
        actorUserId: verification.userId,
        action: "auth_mfa_challenge_failed",
        entityType: "auth_mfa_challenge",
        data: { code: verification.code }
      }).catch(() => {});
    }
    return Response.json(
      {
        error: verification.code === "too_many_attempts" ? "Too many attempts" : "Invalid MFA code",
        code: verification.code
      },
      { status: verification.code === "too_many_attempts" ? 429 : 401 }
    );
  }

  await createSession(verification.userId, {
    authProvider: "password_mfa",
    requestHeaders: request.headers
  });

  await recordAuditLog({
    tenantKey: verification.tenantKey,
    workspaceKey: verification.workspaceKey,
    actorUserId: verification.userId,
    action: "auth_mfa_challenge_verified",
    entityType: "auth_mfa_challenge",
    entityId: verification.challengeId,
    data: {
      factorId: verification.factorId
    }
  }).catch(() => {});

  await recordAuditLog({
    tenantKey: verification.tenantKey,
    workspaceKey: verification.workspaceKey,
    actorUserId: verification.userId,
    action: "auth_login_success",
    entityType: "auth_session",
    data: {
      authProvider: "password_mfa",
      mfaSatisfied: true,
      factorId: verification.factorId,
      challengeId: verification.challengeId
    }
  }).catch(() => {});

  return Response.json({ status: "ok" });
}
