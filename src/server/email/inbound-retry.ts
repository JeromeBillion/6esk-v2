import { inboundEmailSchema } from "@/server/email/schema";
import { storeInboundEmail } from "@/server/email/inbound-store";
import { lockFailedInboundEvents, markInboundFailed, markInboundProcessed } from "@/server/email/inbound-events";

export async function retryFailedInboundEvents(limit = 10) {
  const events = await lockFailedInboundEvents(limit);
  if (!events.length) {
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const event of events) {
    const parsed = inboundEmailSchema.safeParse(event.payload);
    if (!parsed.success) {
      await markInboundFailed({
        id: event.id,
        error: "Stored payload is invalid for inbound schema"
      });
      failed += 1;
      continue;
    }

    try {
      const result = await storeInboundEmail(parsed.data);
      await markInboundProcessed({
        id: event.id,
        messageId: result.messageId,
        ticketId: result.ticketId ?? null
      });
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process inbound";
      await markInboundFailed({ id: event.id, error: message });
      failed += 1;
    }
  }

  return { processed, failed };
}
