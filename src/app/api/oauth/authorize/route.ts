import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { getSessionUser } from "@/server/auth/session";
import { buildGoogleAuthUrl } from "@/server/oauth/providers/google";
import { buildMicrosoftAuthUrl } from "@/server/oauth/providers/microsoft";
import { hasTenantAdminAccess } from "@/server/auth/roles";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const type = searchParams.get("type"); // "platform" | "personal"

  if (provider !== "google" && provider !== "microsoft" && provider !== "zoho") {
    return new Response("Invalid provider", { status: 400 });
  }

  if (type !== "platform" && type !== "personal") {
    return new Response("Invalid type. Must be 'platform' or 'personal'", { status: 400 });
  }

  // Only admins can connect platform (shared domain) mailboxes
  if (type === "platform" && !hasTenantAdminAccess(session)) {
    return new Response("Forbidden: Only admins can connect platform mailboxes", { status: 403 });
  }

  const nonce = randomBytes(16).toString("hex");

  const statePayload = {
    nonce,
    provider,
    type,
    tenantId: session.tenant_id,
    userId: session.id
  };

  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

  let authUrl = "";
  if (provider === "google") {
    authUrl = buildGoogleAuthUrl(state);
  } else if (provider === "microsoft") {
    authUrl = buildMicrosoftAuthUrl(state);
  } else if (provider === "zoho") {
    const { buildZohoAuthUrl } = await import("@/server/oauth/providers/zoho");
    authUrl = buildZohoAuthUrl(state);
  }

  const response = new Response(null, {
    status: 302,
    headers: {
      Location: authUrl
    }
  });

  // Set HTTP-only cookie with the nonce to prevent CSRF
  response.headers.append(
    "Set-Cookie",
    `oauth_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900; ${process.env.NODE_ENV === "production" ? "Secure" : ""}`
  );

  return response;
}
