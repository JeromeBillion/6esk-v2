import { cookies } from "next/headers";
import { z } from "zod";
import { createSession } from "@/server/auth/session";
import { verifyMfaChallenge } from "@/server/auth/mfa";
import { recordAuditLog } from "@/server/audit";

const challengeSchema = z.object({
  challengeToken: z.string().min(1).optional().nullable(),
  code: z.string().min(1)
});

const AUTH_OAUTH_MFA_CHALLENGE_COOKIE = "sixesk_auth_oauth_mfa_challenge";

async function clearOAuthMfaChallengeCookie() {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_OAUTH_MFA_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/mfa",
    expires: new Date(0)
  });
}

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

  const cookieStore = await cookies();
  const cookieChallengeToken = cookieStore.get(AUTH_OAUTH_MFA_CHALLENGE_COOKIE)?.value?.trim() || null;
  const bodyChallengeToken = parsed.data.challengeToken?.trim() || null;
  const challengeToken = bodyChallengeToken ?? cookieChallengeToken;
  const usingCookieChallenge = !bodyChallengeToken && Boolean(cookieChallengeToken);
  if (!challengeToken) {
    return Response.json({ error: "Invalid MFA challenge" }, { status: 400 });
  }

  const result = await verifyMfaChallenge({
    challengeToken,
    code: parsed.data.code
  });
  if (!result.ok) {
    if (usingCookieChallenge && result.code !== "invalid_code") {
      await clearOAuthMfaChallengeCookie();
    }
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
  if (usingCookieChallenge) {
    await clearOAuthMfaChallengeCookie();
  }
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
