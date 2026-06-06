import { createSession } from "@/server/auth/session";
import { getBetterAuthReadiness } from "@/server/auth/better-auth-readiness";
import { sixeskBetterAuth } from "@/server/auth/better-auth";
import { createMfaChallenge, hasActiveMfaFactor, isMfaRequiredForLogin } from "@/server/auth/mfa";
import {
  lookupBetterAuthProviderAccount,
  resolveBetterAuthBridgeUser,
  sanitizeBetterAuthNextPath,
  upsertAuthIdentityAccount
} from "@/server/auth/better-auth-bridge";
import { recordAuditLog } from "@/server/audit";

function wantsJson(request: Request) {
  return request.headers.get("accept")?.includes("application/json") ?? false;
}

function readinessResponse() {
  const readiness = getBetterAuthReadiness();
  if (!readiness.routeEnabled) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(
    {
      error: "Better Auth bridge is not ready",
      code: "better_auth_bridge_not_ready",
      blockers: readiness.blockers
    },
    { status: 503 }
  );
}

export async function GET(request: Request) {
  const readiness = getBetterAuthReadiness();
  if (!readiness.ready) {
    return readinessResponse();
  }

  const betterSession = await sixeskBetterAuth.api.getSession({
    headers: request.headers,
    query: {
      disableCookieCache: true,
      disableRefresh: true
    }
  });
  const email = betterSession?.user.email?.trim().toLowerCase();
  if (!betterSession || !email) {
    return Response.json({ error: "Federated session required" }, { status: 401 });
  }

  const bridgeResolution = await resolveBetterAuthBridgeUser(email);
  if (!bridgeResolution.ok) {
    await recordAuditLog({
      tenantKey: "primary",
      workspaceKey: "primary",
      action: "better_auth_bridge_denied",
      entityType: "auth_identity",
      data: {
        code: bridgeResolution.code,
        emailDomain: email.split("@").at(-1) ?? null
      }
    }).catch(() => {});
    return Response.json(
      {
        error: bridgeResolution.message,
        code: bridgeResolution.code
      },
      { status: bridgeResolution.status }
    );
  }

  const provider = await lookupBetterAuthProviderAccount(betterSession.user.id);
  const linkedAccount = await upsertAuthIdentityAccount({
    user: bridgeResolution.user,
    provider,
    betterAuthUserId: betterSession.user.id,
    betterAuthSessionId: betterSession.session.id,
    email
  });

  const mfaRequired = await isMfaRequiredForLogin(bridgeResolution.user);
  const url = new URL(request.url);
  const next = sanitizeBetterAuthNextPath(url.searchParams.get("next"));

  if (mfaRequired && (await hasActiveMfaFactor(bridgeResolution.user))) {
    const challenge = await createMfaChallenge(bridgeResolution.user);
    await recordAuditLog({
      tenantKey: bridgeResolution.user.tenant_key,
      workspaceKey: bridgeResolution.user.workspace_key,
      actorUserId: bridgeResolution.user.id,
      action: "auth_mfa_challenge_created",
      entityType: "auth_mfa_challenge",
      data: {
        authProvider: "better_auth",
        provider: linkedAccount.providerId,
        betterAuthSessionId: betterSession.session.id
      }
    }).catch(() => {});

    if (wantsJson(request)) {
      return Response.json({
        status: "mfa_required",
        challengeToken: challenge.challengeToken,
        expiresAt: challenge.expiresAt,
        next,
        provider: linkedAccount.providerId
      });
    }

    const mfaUrl = new URL("/login", request.url);
    mfaUrl.searchParams.set("mfaChallenge", challenge.challengeToken);
    mfaUrl.searchParams.set("next", next);
    return Response.redirect(mfaUrl);
  }

  await createSession(bridgeResolution.user.id, {
    authProvider: mfaRequired ? "better_auth_mfa_enrollment_required" : "better_auth",
    requestHeaders: request.headers
  });

  await recordAuditLog({
    tenantKey: bridgeResolution.user.tenant_key,
    workspaceKey: bridgeResolution.user.workspace_key,
    actorUserId: bridgeResolution.user.id,
    action: "better_auth_bridge_session_created",
    entityType: "auth_identity",
    entityId: bridgeResolution.user.id,
    data: {
      provider: linkedAccount.providerId,
      betterAuthSessionId: betterSession.session.id,
      mfaEnrollmentRequired: mfaRequired
    }
  });

  if (wantsJson(request)) {
    return Response.json({
      status: "ok",
      next,
      provider: linkedAccount.providerId,
      mfaEnrollmentRequired: mfaRequired
    });
  }
  return Response.redirect(new URL(mfaRequired ? "/admin?mfaEnrollment=required" : next, request.url));
}
