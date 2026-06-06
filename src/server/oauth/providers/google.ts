import { getEnv } from "@/server/env";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email"
].join(" ");

export function buildGoogleAuthUrl(state: string): string {
  const env = getEnv();
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error("Google OAuth is not configured. Missing CLIENT_ID or REDIRECT_URI.");
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // Force consent to get refresh token
  url.searchParams.set("state", state);

  return url.toString();
}

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
};

export async function exchangeGoogleCode(code: string): Promise<GoogleTokens> {
  const env = getEnv();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      code,
      grant_type: "authorization_code",
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI || ""
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google token exchange failed: ${errorBody}`);
  }

  const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in
  };
}

export async function refreshGoogleToken(refreshToken: string): Promise<GoogleTokens> {
  const env = getEnv();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google token refresh failed: ${errorBody}`);
  }

  const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken, // Keep old if new one not provided
    expiresIn: data.expires_in
  };
}

export async function fetchGoogleUserProfile(accessToken: string): Promise<{ email: string; id: string }> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch Google profile: ${errorBody}`);
  }

  const data = await response.json() as { email: string; id: string };
  return { email: data.email.toLowerCase(), id: data.id };
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

export async function sendGmailMessage(accessToken: string, payload: EmailPayload): Promise<{ messageId: string }> {
  // Construct raw RFC 2822 message
  const lines: string[] = [];
  lines.push(`To: ${payload.to.join(", ")}`);
  if (payload.cc?.length) lines.push(`Cc: ${payload.cc.join(", ")}`);
  if (payload.bcc?.length) lines.push(`Bcc: ${payload.bcc.join(", ")}`);
  if (payload.replyTo) lines.push(`Reply-To: ${payload.replyTo}`);
  if (payload.inReplyTo) lines.push(`In-Reply-To: ${payload.inReplyTo}`);
  if (payload.references?.length) lines.push(`References: ${payload.references.join(" ")}`);

  // Safe base64 encoding of subject
  const subjectEncoded = Buffer.from(payload.subject).toString('base64');
  lines.push(`Subject: =?utf-8?B?${subjectEncoded}?=`);

  // Very basic text/html multiplexing without attachments for phase 1.
  // In a real robust implementation, we'd use a proper MIME builder like nodemailer/mailcomposer.
  if (payload.html && payload.text) {
    const boundary = `----=_Part_${Date.now()}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("");
    lines.push(payload.text);
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("");
    lines.push(payload.html);
    lines.push(`--${boundary}--`);
  } else if (payload.html) {
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("");
    lines.push(payload.html);
  } else {
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("");
    lines.push(payload.text || "");
  }

  const rawMessage = lines.join("\r\n");
  const encodedRaw = Buffer.from(rawMessage).toString("base64url");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      raw: encodedRaw
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gmail API send failed: ${errorBody}`);
  }

  const result = await response.json() as { id: string; threadId: string };
  return { messageId: result.id };
}

export async function subscribeToGooglePush(accessToken: string): Promise<{ historyId: string; expiration: string }> {
  const env = await import("@/server/env").then(m => m.getEnv());
  // E.g. projects/my-project/topics/gmail-events
  const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
  if (!topicName) {
    throw new Error("GOOGLE_PUBSUB_TOPIC is not configured");
  }

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      labelIds: ["INBOX"],
      topicName: topicName
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gmail API watch failed: ${errorBody}`);
  }

  return await response.json() as { historyId: string; expiration: string };
}
