import { inboundEmailSchema } from "@/server/email/schema";
import { resolveInboundMailboxForEmail, storeInboundEmail } from "@/server/email/inbound-store";
import { lockFailedInboundEvents, markInboundFailed, markInboundProcessed } from "@/server/email/inbound-events";
import { db } from "@/server/db";

type RetryInboundInput = {
  tenantId: string;
  limit?: number;
  eventIds?: string[];
};

type LockedInboundEvent = {
  id: string;
  tenant_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

async function lockSpecificFailedInboundEvents(tenantId: string, eventIds: string[]) {
  const normalizedIds = Array.from(
    new Set(eventIds.map((value) => value.trim()).filter(Boolean))
  ).slice(0, 100);
  if (normalizedIds.length === 0) {
    return [];
  }

  const result = await db.query(
    `UPDATE inbound_events
     SET status = 'processing',
         updated_at = now()
     WHERE status = 'failed'
       AND tenant_id = $1
       AND id::text = ANY($2::text[])
     RETURNING id, tenant_id, payload, attempt_count`,
    [tenantId, normalizedIds]
  );
  return result.rows as LockedInboundEvent[];
}

export async function retryFailedInboundEvents(input: RetryInboundInput) {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const targetIds = Array.isArray(input.eventIds) ? input.eventIds : [];
  const events =
    targetIds.length > 0
      ? await lockSpecificFailedInboundEvents(input.tenantId, targetIds)
      : await lockFailedInboundEvents({ tenantId: input.tenantId, limit });
  if (!events.length) {
    return { requested: targetIds.length > 0 ? targetIds.length : limit, retried: 0, failed: 0, ids: [] as string[] };
  }

  let retried = 0;
  let failed = 0;
  const successfulIds: string[] = [];

  for (const event of events) {
    const parsed = inboundEmailSchema.safeParse(event.payload);
    if (!parsed.success) {
      await markInboundFailed({
        id: event.id,
        tenantId: event.tenant_id,
        error: "Stored payload is invalid for inbound schema"
      });
      failed += 1;
      continue;
    }

    try {
      const mailbox = await resolveInboundMailboxForEmail(parsed.data);
      if (!mailbox || mailbox.tenant_id !== event.tenant_id) {
        throw new Error("Stored payload does not resolve to the event tenant");
      }

      const result = await storeInboundEmail(parsed.data, { mailbox });
      await markInboundProcessed({
        id: event.id,
        tenantId: event.tenant_id,
        messageId: result.messageId,
        ticketId: result.ticketId ?? null
      });
      retried += 1;
      successfulIds.push(event.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process inbound";
      await markInboundFailed({ id: event.id, tenantId: event.tenant_id, error: message });
      failed += 1;
    }
  }

  return {
    requested: targetIds.length > 0 ? targetIds.length : limit,
    retried,
    failed,
    ids: successfulIds
  };
}
