import type { EmailReceivedEvent } from "resend";
import { processInboundEmailPayload } from "@/server/email/process-inbound";
import { mapReceivedEmailToInboundPayload, verifyResendWebhookPayload } from "@/server/email/resend-webhook";
import {
  integrationError,
  integrationSuccess,
  validateIntegrationApiVersion
} from "@/server/api-contract";

export async function POST(request: Request) {
  const versionError = validateIntegrationApiVersion(request);
  if (versionError) {
    return versionError;
  }

  const payload = await request.text();

  let event;
  try {
    event = verifyResendWebhookPayload({
      payload,
      headers: request.headers
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature";
    return integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized",
      details: message
    });
  }

  if (event.type !== "email.received") {
    return integrationSuccess(request, { status: "ignored", event: event.type });
  }

  try {
    const inboundPayload = await mapReceivedEmailToInboundPayload(event as EmailReceivedEvent);
    const result = await processInboundEmailPayload(inboundPayload);
    return integrationSuccess(
      request,
      {
        ...result.body,
        event: event.type,
        emailId: event.data.email_id
      },
      {
        status: result.status
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process Resend webhook";
    return integrationError(request, {
      status: 500,
      code: "webhook_processing_failed",
      message: "Failed to process webhook",
      details: message
    });
  }
}
