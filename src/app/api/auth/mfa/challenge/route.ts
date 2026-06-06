import { z } from "zod";
import { createSession } from "@/server/auth/session";
import { verifyMfaChallenge } from "@/server/auth/mfa";
import { recordAuditLog } from "@/server/audit";

const challengeSchema = z.object({
  challengeToken: z.string().min(1),
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

  const result = await verifyMfaChallenge(parsed.data);
  if (!result.ok) {
    await recordAuditLog({
      tenantId: result.tenantId ?? null,
      actorUserId: result.userId ?? null,
      action: "auth_mfa_challenge_failed",
      entityType: "auth_mfa_challenge",
      data: { reason: result.code }
    });
    return Response.json({ error: "Invalid MFA challenge", code: result.code }, { status: 401 });
  }

  const authProvider = result.authProvider ?? "password_mfa";
  await createSession(result.userId, {
    authProvider,
    requestHeaders: request.headers
  });
  await recordAuditLog({
    tenantId: result.tenantId,
    actorUserId: result.userId,
    action: "auth_mfa_challenge_verified",
    entityType: "auth_mfa_challenge",
    entityId: result.challengeId,
    data: {
      factorId: result.factorId,
      authProvider
    }
  });

  return Response.json({ status: "ok" });
}
