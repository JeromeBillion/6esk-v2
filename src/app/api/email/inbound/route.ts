import { inboundEmailSchema } from "@/server/email/schema";
import { computeIdempotencyKey, createInboundEvent, markInboundFailed, markInboundProcessed } from "@/server/email/inbound-events";
import { storeInboundEmail } from "@/server/email/inbound-store";

function getSharedSecret() {
  return process.env.INBOUND_SHARED_SECRET ?? "";
}

export async function POST(request: Request) {
  const sharedSecret = getSharedSecret();
  if (sharedSecret) {
    const provided = request.headers.get("x-6esk-secret");
    if (provided !== sharedSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = inboundEmailSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const idempotencyKey = computeIdempotencyKey(data);
  const inboundEvent = await createInboundEvent({ idempotencyKey, payload: data });
  if (inboundEvent.duplicate) {
    return Response.json({ status: "duplicate", id: inboundEvent.messageId ?? null });
  }

  try {
    const result = await storeInboundEmail(data);
    await markInboundProcessed({
      id: inboundEvent.id,
      messageId: result.messageId,
      ticketId: result.ticketId ?? null
    });
    return Response.json({ status: result.status, id: result.messageId, mailboxId: result.mailboxId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process inbound";
    await markInboundFailed({ id: inboundEvent.id, error: message });
    return Response.json(
      { error: "Failed to process inbound", details: message },
      { status: 500 }
    );
  }
}
