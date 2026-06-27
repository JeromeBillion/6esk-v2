import { NextRequest } from "next/server";
import { requestLogger } from "@/server/logger";
import { getMicrosoftWebhookClientState } from "@/server/oauth/providers/microsoft";

export async function POST(request: NextRequest) {
  const log = requestLogger(request, { route: "POST /api/oauth/webhooks/microsoft" });
  // 1. Handle validation request
  const validationToken = request.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  }

  // 2. Handle notifications
  try {
    const body = await request.json();
    if (!body.value || !Array.isArray(body.value)) {
      log.warn("Microsoft OAuth webhook rejected invalid payload");
      return new Response("Invalid payload", { status: 400 });
    }

    let expectedClientState: string;
    try {
      expectedClientState = getMicrosoftWebhookClientState();
    } catch (error) {
      log.error("Microsoft OAuth webhook validation is not configured", { error });
      return new Response("Webhook validation is not configured", { status: 503 });
    }

    let acceptedNotifications = 0;
    for (const notification of body.value) {
      if (notification.clientState !== expectedClientState) {
        continue;
      }

      // Subscription IDs are not yet mapped to connections, so valid notifications
      // wake the regular tenant-scoped sync job below.
      acceptedNotifications += 1;
    }

    if (acceptedNotifications > 0) {
      fetch(new URL("/api/cron/sync-mailboxes", request.url).toString(), {
        headers: {
          Authorization: `Bearer ${process.env.CRON_SECRET || ""}`
        }
      }).catch(e => log.error("Microsoft OAuth webhook failed to wake mailbox sync", { error: e }));
    }

    log.info("Microsoft OAuth webhook accepted notifications", {
      notificationCount: body.value.length,
      acceptedNotifications
    });

    return new Response("OK", { status: 200 });

  } catch (error) {
    log.error("Microsoft OAuth webhook processing failed", { error });
    return new Response("Error", { status: 200 });
  }
}
