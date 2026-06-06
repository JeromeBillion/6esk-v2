import { getEnv } from "@/server/env";
import { EmailPayload } from "./google"; // Reusing the type

const ZOHO_SCOPES = [
  "ZohoMail.messages.READ",
  "ZohoMail.messages.CREATE",
  "ZohoMail.accounts.READ"
].join(" ");

export function buildZohoAuthUrl(state: string): string {
  const env = getEnv();
  const clientId = process.env.ZOHO_OAUTH_CLIENT_ID;
  const redirectUri = process.env.ZOHO_OAUTH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error("Zoho OAuth is not configured. Missing CLIENT_ID or REDIRECT_URI.");
  }

  const url = new URL("https://accounts.zoho.com/oauth/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ZOHO_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return url.toString();
}

export type ZohoTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
};

export async function exchangeZohoCode(code: string): Promise<ZohoTokens> {
  const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ZOHO_OAUTH_CLIENT_ID || "",
      client_secret: process.env.ZOHO_OAUTH_CLIENT_SECRET || "",
      code,
      grant_type: "authorization_code",
      redirect_uri: process.env.ZOHO_OAUTH_REDIRECT_URI || ""
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Zoho token exchange failed: ${errorBody}`);
  }

  const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in
  };
}

export async function refreshZohoToken(refreshToken: string): Promise<ZohoTokens> {
  const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ZOHO_OAUTH_CLIENT_ID || "",
      client_secret: process.env.ZOHO_OAUTH_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Zoho token refresh failed: ${errorBody}`);
  }

  const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn: data.expires_in
  };
}

export async function fetchZohoUserProfile(accessToken: string): Promise<{ email: string; accountId: string }> {
  // Zoho requires fetching accounts to get the primary email
  const response = await fetch("https://mail.zoho.com/api/accounts", {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch Zoho profile: ${errorBody}`);
  }

  const data = await response.json() as { data: { accountId: string; primaryEmailAddress: string }[] };
  const account = data.data[0];

  if (!account) {
    throw new Error("Zoho profile does not contain an email address.");
  }

  return { email: account.primaryEmailAddress.toLowerCase(), accountId: account.accountId };
}

export async function sendZohoMessage(accessToken: string, accountId: string, payload: EmailPayload): Promise<{ messageId: string }> {
  // Zoho send API
  const response = await fetch(`https://mail.zoho.com/api/accounts/${accountId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fromAddress: payload.replyTo, // Typically the account email
      toAddress: payload.to.join(","),
      ccAddress: payload.cc?.join(","),
      bccAddress: payload.bcc?.join(","),
      subject: payload.subject,
      content: payload.html || payload.text || ""
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Zoho Mail API send failed: ${errorBody}`);
  }

  const result = await response.json() as { data: { messageId: string } };
  return { messageId: result.data.messageId };
}
