import { NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { encryptToken } from "@/server/oauth/crypto";
import { createOAuthConnection } from "@/server/oauth/connections";
import { exchangeGoogleCode, fetchGoogleUserProfile } from "@/server/oauth/providers/google";
import { exchangeMicrosoftCode, fetchMicrosoftUserProfile } from "@/server/oauth/providers/microsoft";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return new Response(`OAuth Error: ${error}`, { status: 400 });
  }

  if (!code || !stateRaw) {
    return new Response("Missing code or state", { status: 400 });
  }

  // Verify state
  let state: { nonce: string; provider: string; type: string; tenantId: string; userId: string };
  try {
    state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
  } catch (e) {
    return new Response("Invalid state parameter", { status: 400 });
  }

  const expectedNonce = request.cookies.get("oauth_nonce")?.value;
  if (!expectedNonce || state.nonce !== expectedNonce) {
    return new Response("CSRF verification failed", { status: 403 });
  }

  // Double check session matches the one that started the flow
  if (session.id !== state.userId || session.tenant_id !== state.tenantId) {
    return new Response("Session mismatch", { status: 403 });
  }

  let accessToken: string;
  let refreshToken: string | null;
  let expiresIn: number;
  let emailAddress: string;
  let providerAccountId: string;
  let scopes: string[];

  try {
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
      return new Response("Unknown provider", { status: 400 });
    }
  } catch (err) {
    console.error("[OAuth Callback] Token exchange failed:", err);
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
            `INSERT INTO mailbox_memberships (mailbox_id, user_id, access_level)
             VALUES ($1, $2, 'owner')`,
            [mailboxId, state.userId]
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
      console.warn(`[OAuth] Failed to setup push notifications for ${emailAddress}. Falling back to 60s cron.`, pushErr);
    }

    // Redirect to success page or settings
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/settings/mailboxes?success=true"
      }
    });

  } catch (err) {
    console.error("[OAuth Callback] Transaction failed:", err);
    return new Response("Internal error creating mailbox connection", { status: 500 });
  }
}
