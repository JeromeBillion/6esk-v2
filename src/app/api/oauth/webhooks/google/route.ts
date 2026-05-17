import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { requestLogger } from "@/server/logger";
import { syncConnection } from "@/server/oauth/sync-engine";

export async function POST(request: NextRequest) {
  const log = requestLogger(request, { route: "POST /api/oauth/webhooks/google" });
  try {
    const body = await request.json();

    if (!body.message || !body.message.data) {
      log.warn("Google OAuth webhook rejected invalid payload");
      return new Response("Invalid payload", { status: 400 });
    }

    const decodedData = Buffer.from(body.message.data, "base64").toString("utf-8");
    const payload = JSON.parse(decodedData) as { emailAddress: string; historyId: string };

    if (!payload.emailAddress) {
      log.warn("Google OAuth webhook missing email address");
      return new Response("Missing emailAddress", { status: 400 });
    }

    // Find the active connection
    const result = await db.query(
      `SELECT id, tenant_id, provider, email_address, token_expires_at, sync_cursor
       FROM oauth_connections
       WHERE email_address = $1 AND provider = 'google' AND sync_status = 'active'
       LIMIT 1`,
      [payload.emailAddress]
    );

    const conn = result.rows[0];
    if (!conn) {
      // It's possible the connection was revoked or deleted. Just acknowledge to stop retries.
      log.info("Google OAuth webhook acknowledged unknown connection");
      return new Response("Connection not found", { status: 200 });
    }

    // Trigger sync asynchronously so we don't block the Pub/Sub response (timeout is typically 10s)
    // We swallow errors because the 60s cron is the fallback mechanism.
    const syncLog = log.child({
      provider: "google",
      tenantId: conn.tenant_id,
      connectionId: conn.id
    });
    syncConnection(conn).catch((err) => {
      syncLog.error("Google OAuth webhook async sync failed", { error: err });
    });

    return new Response("OK", { status: 200 });

  } catch (error) {
    log.error("Google OAuth webhook processing failed", { error });
    // Return 200 to acknowledge and prevent excessive retries if it's a parsing error
    return new Response("Error", { status: 200 });
  }
}
