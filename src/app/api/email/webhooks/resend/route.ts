import type { EmailReceivedEvent } from "resend";
import { processInboundEmailPayload } from "@/server/email/process-inbound";
import { mapReceivedEmailToInboundPayload, verifyResendWebhookPayload } from "@/server/email/resend-webhook";

export async function POST(request: Request) {
  const payload = await request.text();

  let event;
  try {
    event = verifyResendWebhookPayload({
      payload,
      headers: request.headers
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature";
    return Response.json({ error: "Unauthorized", details: message }, { status: 401 });
  }

  if (event.type !== "email.received") {
    return Response.json({ status: "ignored", event: event.type });
  }

  try {
    const inboundPayload = await mapReceivedEmailToInboundPayload(event as EmailReceivedEvent);
    const result = await processInboundEmailPayload(inboundPayload);
    return Response.json(
      {
        ...result.body,
        event: event.type,
        emailId: event.data.email_id
      },
      { status: result.status }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process Resend webhook";
    return Response.json({ error: "Failed to process webhook", details: message }, { status: 500 });
  }
}
