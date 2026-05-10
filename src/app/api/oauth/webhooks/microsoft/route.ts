import { NextRequest } from "next/server";
import { getMicrosoftWebhookClientState } from "@/server/oauth/providers/microsoft";

export async function POST(request: NextRequest) {
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
      return new Response("Invalid payload", { status: 400 });
    }

    let expectedClientState: string;
    try {
      expectedClientState = getMicrosoftWebhookClientState();
    } catch (error) {
      console.error("[Microsoft Webhook] Validation is not configured:", error);
      return new Response("Webhook validation is not configured", { status: 503 });
    }

    for (const notification of body.value) {
      if (notification.clientState !== expectedClientState) {
        continue;
      }

      // Subscription IDs are not yet mapped to connections, so valid notifications
      // wake the regular tenant-scoped sync job below.
    }

    fetch(new URL("/api/cron/sync-mailboxes", request.url).toString(), {
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET || ""}`
      }
    }).catch(e => console.error("Failed to wake up sync engine:", e));

    return new Response("OK", { status: 200 });

  } catch (error) {
    console.error("[Microsoft Webhook] Processing failed:", error);
    return new Response("Error", { status: 200 });
  }
}
