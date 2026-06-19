import { NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { requestLogger } from "@/server/logger";
import { encryptToken } from "@/server/oauth/crypto";
import { createOAuthConnection } from "@/server/oauth/connections";
import { exchangeGoogleCode, fetchGoogleUserProfile } from "@/server/oauth/providers/google";
import { exchangeMicrosoftCode, fetchMicrosoftUserProfile } from "@/server/oauth/providers/microsoft";

export async function GET(request: NextRequest) {
  const log = requestLogger(request, { route: "GET /api/oauth/callback" });
  const session = await getSessionUser();
  if (!session) {
    log.warn("OAuth callback rejected without session");
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    log.warn("OAuth provider returned an error", { providerError: error });
    return new Response(`OAuth Error: ${error}`, { status: 400 });
  }

  if (!code || !stateRaw) {
    log.warn("OAuth callback missing code or state", {
      hasCode: Boolean(code),
      hasState: Boolean(stateRaw)
    });
    return new Response("Missing code or state", { status: 400 });
  }

  // Verify state
  let state: { nonce: string; provider: string; type: string; tenantId: string; userId: string };
  try {
    state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
  } catch {
    log.warn("OAuth callback state parameter was invalid");
    return new Response("Invalid state parameter", { status: 400 });
  }

  const expectedNonce = request.cookies.get("oauth_nonce")?.value;
  if (!expectedNonce || state.nonce !== expectedNonce) {
    log.warn("OAuth callback CSRF verification failed", {
      provider: state.provider,
      tenantId: state.tenantId,
      userId: state.userId
    });
    return new Response("CSRF verification failed", { status: 403 });
  }

  // Double check session matches the one that started the flow
  if (session.id !== state.userId || session.tenant_id !== state.tenantId) {
    log.warn("OAuth callback session mismatch", {
      provider: state.provider,
      sessionUserId: session.id,
      sessionTenantId: session.tenant_id,
      stateUserId: state.userId,
      stateTenantId: state.tenantId
    });
    return new Response("Session mismatch", { status: 403 });
  }

  let accessToken: string;
  let refreshToken: string | null;
  let expiresIn: number;
  let emailAddress: string;
  let providerAccountId: string;
  let scopes: string[];

  try {
    const providerLog = log.child({ provider: state.provider, tenantId: state.tenantId });
    if (state.provider === "google") {
      const tokens = await exchangeGoogleCode(code);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
      expiresIn = tokens.expiresIn;

      const profile = await fetchGoogleUserProfile(accessToken);
      emailAddress = profile.email;
      providerAccountId = profile.id;

      scopes = [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email"
      ];
    } else if (state.provider === "microsoft") {
      const tokens = await exchangeMicrosoftCode(code);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
      expiresIn = tokens.expiresIn;

      const profile = await fetchMicrosoftUserProfile(accessToken);
      emailAddress = profile.email;
      providerAccountId = profile.id;

      scopes = [
        "Mail.Read",
        "Mail.Send",
        "User.Read",
        "offline_access"
      ];
    } else if (state.provider === "zoho") {
      const { exchangeZohoCode, fetchZohoUserProfile } = await import("@/server/oauth/providers/zoho");
      const tokens = await exchangeZohoCode(code);
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
      expiresIn = tokens.expiresIn;

      const profile = await fetchZohoUserProfile(accessToken);
      emailAddress = profile.email;
      providerAccountId = profile.accountId;

      scopes = [
        "ZohoMail.messages.READ",
        "ZohoMail.messages.CREATE",
        "ZohoMail.accounts.READ"
      ];
    } else {
      providerLog.warn("OAuth callback received unknown provider");
      return new Response("Unknown provider", { status: 400 });
    }
  } catch (err) {
    log.error("OAuth callback token exchange failed", {
      error: err,
      provider: state.provider,
      tenantId: state.tenantId
    });
    return new Response("Failed to exchange authorization code", { status: 500 });
  }

  // Refresh token is required on first connect
  if (!refreshToken) {
    return new Response("Provider did not return a refresh token. Please revoke access and try again.", { status: 400 });
  }

  // Encrypt both tokens together into one AES-GCM payload to reuse the single IV in schema
  const combinedTokens = JSON.stringify({ accessToken, refreshToken });
  const encrypted = encryptToken(combinedTokens);

  // Calculate expiry
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  try {
    // 1. Create or update oauth connection
    const { id: connectionId } = await createOAuthConnection({
      tenantId: state.tenantId,
      provider: state.provider as any,
      emailAddress,
      accessTokenEnc: encrypted.ciphertext,
      refreshTokenEnc: Buffer.alloc(0), // Unused, payload is combined
      tokenIv: encrypted.iv,
      expiresAt,
      scopes,
      providerAccountId,
      connectedBy: state.userId
    });

    // 2. Upsert mailbox
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const existingMailboxResult = await client.query(
        "SELECT id FROM mailboxes WHERE address = $1 AND tenant_id = $2",
        [emailAddress, state.tenantId]
      );

      let mailboxId: string;

      if (existingMailboxResult.rows.length > 0) {
        mailboxId = existingMailboxResult.rows[0].id;
        await client.query(
          "UPDATE mailboxes SET provider = $1, oauth_connection_id = $2 WHERE id = $3 AND tenant_id = $4",
          [state.provider, connectionId, mailboxId, state.tenantId]
        );
      } else {
        const type = state.type === "platform" ? "platform" : "personal";
        const ownerId = type === "personal" ? state.userId : null;

        const insertResult = await client.query(
          `INSERT INTO mailboxes (tenant_id, type, address, owner_user_id, provider, oauth_connection_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [state.tenantId, type, emailAddress, ownerId, state.provider, connectionId]
        );
        mailboxId = insertResult.rows[0].id;

        if (type === "personal") {
          await client.query(
            `INSERT INTO mailbox_memberships (tenant_id, mailbox_id, user_id, access_level)
             VALUES ($1, $2, $3, 'owner')
             ON CONFLICT (mailbox_id, user_id) DO UPDATE SET
               tenant_id = EXCLUDED.tenant_id,
               access_level = EXCLUDED.access_level`,
            [state.tenantId, mailboxId, state.userId]
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Push subscription is a post-commit optimization; cron remains the fallback.
    try {
      if (state.provider === "google") {
        const { subscribeToGooglePush } = await import("@/server/oauth/providers/google");
        await subscribeToGooglePush(accessToken);
      } else if (state.provider === "microsoft") {
        const { subscribeToMicrosoftPush } = await import("@/server/oauth/providers/microsoft");
        await subscribeToMicrosoftPush(accessToken);
      }
    } catch (pushErr) {
      log.warn("OAuth push subscription setup failed; cron fallback remains active", {
        error: pushErr,
        provider: state.provider,
        tenantId: state.tenantId,
        connectionId
      });
    }

    // Redirect to success page or settings
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/settings/mailboxes?success=true"
      }
    });

  } catch (err) {
    log.error("OAuth callback failed to create mailbox connection", {
      error: err,
      provider: state.provider,
      tenantId: state.tenantId
    });
    return new Response("Internal error creating mailbox connection", { status: 500 });
  }
}
