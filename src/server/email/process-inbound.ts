import { inboundEmailSchema } from "@/server/email/schema";
import {
  computeIdempotencyKey,
  createInboundEvent,
  markInboundFailed,
  markInboundProcessed
} from "@/server/email/inbound-events";
import { storeInboundEmail } from "@/server/email/inbound-store";

export async function processInboundEmailPayload(payload: unknown) {
  const parsed = inboundEmailSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Invalid payload", details: parsed.error.flatten() }
    };
  }

  const data = parsed.data;
  const idempotencyKey = computeIdempotencyKey(data);
  const inboundEvent = await createInboundEvent({ idempotencyKey, payload: data });
  if (inboundEvent.duplicate) {
    return {
      status: 200,
      body: { status: "duplicate", id: inboundEvent.messageId ?? null }
    };
  }

  try {
    const result = await storeInboundEmail(data);
    await markInboundProcessed({
      id: inboundEvent.id,
      messageId: result.messageId,
      ticketId: result.ticketId ?? null
    });

    return {
      status: 200,
      body: { status: result.status, id: result.messageId, mailboxId: result.mailboxId }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process inbound";
    await markInboundFailed({ id: inboundEvent.id, error: message });
    return {
      status: 500,
      body: { error: "Failed to process inbound", details: message }
    };
  }
}
