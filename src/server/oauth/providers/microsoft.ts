import { getEnv } from "@/server/env";

const MICROSOFT_SCOPES = [
  "Mail.Read",
  "Mail.Send",
  "User.Read",
  "offline_access"
].join(" ");

export function getMicrosoftWebhookClientState(): string {
  const key = process.env.OAUTH_ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error("OAUTH_ENCRYPTION_KEY is required for Microsoft webhook validation.");
  }
  return key.slice(0, 16);
}

export function buildMicrosoftAuthUrl(state: string): string {
  const env = getEnv();
  const clientId = env.MICROSOFT_OAUTH_CLIENT_ID;
  const redirectUri = env.MICROSOFT_OAUTH_REDIRECT_URI;
  const tenantId = env.MICROSOFT_OAUTH_TENANT_ID || "common"; // "common" for multi-tenant

  if (!clientId || !redirectUri) {
    throw new Error("Microsoft OAuth is not configured. Missing CLIENT_ID or REDIRECT_URI.");
  }

  const url = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", MICROSOFT_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("response_mode", "query");

  return url.toString();
}

export type MicrosoftTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
};

export async function exchangeMicrosoftCode(code: string): Promise<MicrosoftTokens> {
  const env = getEnv();
  const tenantId = env.MICROSOFT_OAUTH_TENANT_ID || "common";

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_OAUTH_CLIENT_ID || "",
      client_secret: env.MICROSOFT_OAUTH_CLIENT_SECRET || "",
      code,
      grant_type: "authorization_code",
      redirect_uri: env.MICROSOFT_OAUTH_REDIRECT_URI || ""
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Microsoft token exchange failed: ${errorBody}`);
  }

  const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in
  };
}

export async function refreshMicrosoftToken(refreshToken: string): Promise<MicrosoftTokens> {
  const env = getEnv();
  const tenantId = env.MICROSOFT_OAUTH_TENANT_ID || "common";

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_OAUTH_CLIENT_ID || "",
      client_secret: env.MICROSOFT_OAUTH_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Microsoft token refresh failed: ${errorBody}`);
  }

  const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken, // Keep old if new one not provided
    expiresIn: data.expires_in
  };
}

export async function fetchMicrosoftUserProfile(accessToken: string): Promise<{ email: string; id: string }> {
  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch Microsoft profile: ${errorBody}`);
  }

  const data = await response.json() as { mail?: string; userPrincipalName: string; id: string };
  // Fallback to UPN if mail is missing
  const email = data.mail || data.userPrincipalName;

  if (!email) {
    throw new Error("Microsoft profile does not contain an email address.");
  }

  return { email: email.toLowerCase(), id: data.id };
}

export type EmailPayload = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string[];
  replyTo?: string;
};

export async function sendOutlookMessage(accessToken: string, payload: EmailPayload): Promise<{ messageId: string }> {
  // Map to Microsoft Graph message object
  const message: any = {
    subject: payload.subject,
    body: {
      contentType: payload.html ? "html" : "text",
      content: payload.html || payload.text || ""
    },
    toRecipients: payload.to.map(email => ({ emailAddress: { address: email } }))
  };

  if (payload.cc?.length) {
    message.ccRecipients = payload.cc.map(email => ({ emailAddress: { address: email } }));
  }

  if (payload.bcc?.length) {
    message.bccRecipients = payload.bcc.map(email => ({ emailAddress: { address: email } }));
  }

  if (payload.replyTo) {
    message.replyTo = [{ emailAddress: { address: payload.replyTo } }];
  }

  // Handle headers if necessary (In-Reply-To, References) using internetMessageHeaders if needed,
  // though Graph API provides specialized fields for replies if using the reply endpoint.
  // For basic sending we can add headers this way:
  const headers = [];
  if (payload.inReplyTo) {
    headers.push({ name: "In-Reply-To", value: payload.inReplyTo });
  }
  if (payload.references?.length) {
    headers.push({ name: "References", value: payload.references.join(" ") });
  }
  if (headers.length > 0) {
    message.internetMessageHeaders = headers;
  }

  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      saveToSentItems: true
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Microsoft Graph API send failed: ${errorBody}`);
  }

  // sendMail returns 202 Accepted without a body.
  // The actual internet message ID is generated asynchronously.
  // To get a message ID, one would usually create a draft and then send it, but sendMail is faster.
  // We'll return a pseudo-ID or rely on tracking it if needed.
  return { messageId: "microsoft-sent-" + Date.now() };
}

export async function subscribeToMicrosoftPush(accessToken: string): Promise<{ id: string; expirationDateTime: string }> {
  const env = await import("@/server/env").then(m => m.getEnv());
  const notificationUrl = process.env.MICROSOFT_WEBHOOK_URL;
  if (!notificationUrl) {
    throw new Error("MICROSOFT_WEBHOOK_URL is not configured");
  }

  const response = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: notificationUrl,
      resource: "me/mailFolders('Inbox')/messages",
      expirationDateTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // max ~3 days
      clientState: getMicrosoftWebhookClientState()
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Microsoft Graph API subscription failed: ${errorBody}`);
  }

  return await response.json() as { id: string; expirationDateTime: string };
}
