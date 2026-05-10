import { db } from "@/server/db";
import { storeInboundEmail } from "@/server/email/inbound-store";
import { getConnectionTokens, updateConnectionTokens } from "@/server/oauth/connections";
import { decryptToken, encryptToken } from "@/server/oauth/crypto";
import { refreshGoogleToken } from "@/server/oauth/providers/google";
import { refreshMicrosoftToken } from "@/server/oauth/providers/microsoft";
import { inboundEmailSchema } from "@/server/email/schema";
import { z } from "zod";

type InboundEmail = z.infer<typeof inboundEmailSchema>;

export async function runSyncEngine() {
  const result = await db.query(
    `SELECT id, tenant_id, provider, email_address, token_expires_at, sync_cursor
     FROM oauth_connections
     WHERE sync_status = 'active'
     ORDER BY last_sync_at ASC NULLS FIRST
     LIMIT 50` // process in batches
  );

  const connections = result.rows;

  for (const conn of connections) {
    try {
      await syncConnection(conn);
    } catch (err) {
      console.error(`[SyncEngine] Failed to sync connection ${conn.id}:`, err);
      await db.query(
        `UPDATE oauth_connections SET last_sync_error = $1, updated_at = now() WHERE id = $2`,
        [String(err), conn.id]
      );
    }
  }
}

export async function syncConnection(conn: any) {
  const tokensEnc = await getConnectionTokens(conn.id);
  if (!tokensEnc) throw new Error("Missing tokens");

  const combinedStr = decryptToken(tokensEnc.accessTokenEnc, tokensEnc.tokenIv);
  let { accessToken, refreshToken } = JSON.parse(combinedStr);

  // Check if token expired (with a 5 min buffer)
  const isExpired = conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now() + 5 * 60000;

  if (isExpired && refreshToken) {
    if (conn.provider === "google") {
      const refreshed = await refreshGoogleToken(refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken ?? refreshToken;

      const newCombined = JSON.stringify({ accessToken, refreshToken });
      const enc = encryptToken(newCombined);
      await updateConnectionTokens(
        conn.id,
        enc.ciphertext,
        Buffer.alloc(0),
        enc.iv,
        new Date(Date.now() + refreshed.expiresIn * 1000)
      );
    } else if (conn.provider === "microsoft") {
      const refreshed = await refreshMicrosoftToken(refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken ?? refreshToken;

      const newCombined = JSON.stringify({ accessToken, refreshToken });
      const enc = encryptToken(newCombined);
      await updateConnectionTokens(
        conn.id,
        enc.ciphertext,
        Buffer.alloc(0),
        enc.iv,
        new Date(Date.now() + refreshed.expiresIn * 1000)
      );
    } else if (conn.provider === "zoho") {
      const { refreshZohoToken } = await import("@/server/oauth/providers/zoho");
      const refreshed = await refreshZohoToken(refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken ?? refreshToken;

      const newCombined = JSON.stringify({ accessToken, refreshToken });
      const enc = encryptToken(newCombined);
      await updateConnectionTokens(
        conn.id,
        enc.ciphertext,
        Buffer.alloc(0),
        enc.iv,
        new Date(Date.now() + refreshed.expiresIn * 1000)
      );
    }
  }

  let newCursor = conn.sync_cursor;

  if (conn.provider === "google") {
    newCursor = await syncGoogleMail(conn, accessToken, newCursor);
  } else if (conn.provider === "microsoft") {
    newCursor = await syncMicrosoftMail(conn, accessToken, newCursor);
  } else if (conn.provider === "zoho") {
    newCursor = await syncZohoMail(conn, accessToken, newCursor);
  }

  await db.query(
    `UPDATE oauth_connections
     SET last_sync_at = now(), sync_cursor = $1, last_sync_error = NULL, updated_at = now()
     WHERE id = $2`,
    [newCursor, conn.id]
  );
}

async function syncGoogleMail(conn: any, accessToken: string, cursor: string | null): Promise<string | null> {
  // Query Gmail API for messages newer than historyId or just unread inbox
  // For Phase 1 we poll UNREAD INBOX and mark as read, or rely on history API.
  // Using a simple query if no cursor
  const query = cursor ? "" : "is:unread IN:INBOX"; // "Start Fresh" rule: if no cursor, we only take current unread or we just get the latest historyId

  let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10`;
  if (!cursor) {
    url += `&q=${encodeURIComponent("is:unread IN:INBOX")}`;
  } else {
    // Ideally we'd use history API: url = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${cursor}`
    // For now we'll stick to basic messages list to satisfy foundation.
    url += `&q=${encodeURIComponent("is:unread IN:INBOX")}`; // Simplified for Phase 1
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail API error: ${await res.text()}`);

  const data = await res.json() as { messages?: { id: string; threadId: string }[] };

  if (data.messages && data.messages.length > 0) {
    for (const msg of data.messages) {
      // Fetch full message
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!msgRes.ok) continue;

      const fullMsg = await msgRes.json();

      // Parse headers
      const headers: Record<string, string> = {};
      for (const h of fullMsg.payload?.headers || []) {
        headers[h.name.toLowerCase()] = h.value;
      }

      const inboundPayload: InboundEmail = {
        from: headers["from"] || "unknown@example.com",
        to: headers["to"] || conn.email_address,
        subject: headers["subject"] || "No Subject",
        text: fullMsg.snippet || "",
        messageId: headers["message-id"] || fullMsg.id,
        date: headers["date"],
        inReplyTo: headers["in-reply-to"],
        references: headers["references"] ? headers["references"].split(/\s+/) : [],
        html: "", // Requires parsing payload parts in full implementation
      };

      try {
        await storeInboundEmail(inboundPayload);

        // Mark as read in Gmail
        await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] })
        });
      } catch (err) {
        console.error(`Failed to store Google message ${msg.id}:`, err);
      }
    }
  }

  // Get current profile to update historyId for next cursor
  const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (profileRes.ok) {
    const profile = await profileRes.json();
    return profile.historyId;
  }

  return cursor;
}

async function syncMicrosoftMail(conn: any, accessToken: string, cursor: string | null): Promise<string | null> {
  let url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=isRead eq false&$top=10`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Graph API error: ${await res.text()}`);

  const data = await res.json() as { value: any[] };

  for (const msg of data.value) {
    const inboundPayload: InboundEmail = {
      from: msg.from?.emailAddress?.address || "unknown@example.com",
      to: msg.toRecipients?.map((r: any) => r.emailAddress.address) || [conn.email_address],
      subject: msg.subject || "No Subject",
      text: msg.bodyPreview || "",
      html: msg.body?.contentType === "html" ? msg.body.content : "",
      messageId: msg.internetMessageId || msg.id,
      date: msg.receivedDateTime,
      inReplyTo: undefined, // Requires expanding specific headers in Graph API
      references: []
    };

    try {
      await storeInboundEmail(inboundPayload);

      // Mark as read
      await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: true })
      });
    } catch (err) {
      console.error(`Failed to store Microsoft message ${msg.id}:`, err);
    }
  }

  // Use delta query in real implementation, for now return Date as cursor
  return Date.now().toString();
}

async function syncZohoMail(conn: any, accessToken: string, cursor: string | null): Promise<string | null> {
  const accountId = conn.provider_account_id;
  if (!accountId) throw new Error("Missing Zoho accountId");

  // Fetch unread messages
  const url = `https://mail.zoho.com/api/accounts/${accountId}/messages/search?searchKey=is:unread&limit=10`;
  const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
  if (!res.ok) throw new Error(`Zoho API error: ${await res.text()}`);

  const data = await res.json() as { data?: any[] };

  if (data.data && data.data.length > 0) {
    for (const msg of data.data) {
      // Fetch specific message content
      const msgRes = await fetch(`https://mail.zoho.com/api/accounts/${accountId}/folders/${msg.folderId}/messages/${msg.messageId}/content`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
      });
      if (!msgRes.ok) continue;
      const contentData = await msgRes.json() as { data: { content: string } };

      const inboundPayload: InboundEmail = {
        from: msg.sender || "unknown@example.com",
        to: msg.toAddress || conn.email_address,
        subject: msg.subject || "No Subject",
        text: msg.summary || "",
        html: contentData.data?.content || "",
        messageId: msg.messageId, // Zoho internal ID
        date: new Date(Number(msg.receivedTime)).toISOString(),
        inReplyTo: undefined,
        references: []
      };

      try {
        await storeInboundEmail(inboundPayload);

        // Mark as read in Zoho
        await fetch(`https://mail.zoho.com/api/accounts/${accountId}/folders/${msg.folderId}/messages`, {
          method: "PUT",
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "markAsRead", messageId: [msg.messageId] })
        });
      } catch (err) {
        console.error(`Failed to store Zoho message ${msg.messageId}:`, err);
      }
    }
  }

  return Date.now().toString();
}
