import { createHash } from "crypto";
import { db } from "@/server/db";
import { normalizeAddressList } from "@/server/email/normalize";

type InboundPayload = {
  from: string;
  to: string | string[];
  subject?: string | null;
  text?: string | null;
  raw?: string | null;
  messageId?: string | null;
  date?: string | null;
};

export function computeIdempotencyKey(payload: InboundPayload) {
  if (payload.messageId) {
    return `message-id:${payload.messageId}`;
  }

  if (payload.raw) {
    const hash = createHash("sha256").update(payload.raw).digest("hex");
    return `raw:${hash}`;
  }

  const from = payload.from?.toLowerCase() ?? "";
  const to = normalizeAddressList(payload.to).join(",");
  const subject = payload.subject ?? "";
  const text = payload.text ?? "";
  const date = payload.date ?? "";
  const hash = createHash("sha256")
    .update([from, to, subject, text, date].join("|"))
    .digest("hex");
  return `fallback:${hash}`;
}

export async function createInboundEvent({
  idempotencyKey,
  payload
}: {
  idempotencyKey: string;
  payload: Record<string, unknown>;
}) {
  const result = await db.query<{ id: string }>(
    `INSERT INTO inbound_events (idempotency_key, payload, status)
     VALUES ($1, $2, 'processing')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [idempotencyKey, payload]
  );

  if (result.rows[0]) {
    return { id: result.rows[0].id, duplicate: false };
  }

  const existing = await db.query<{
    id: string;
    status: string;
    message_id: string | null;
    ticket_id: string | null;
  }>(
    `SELECT id, status, message_id, ticket_id
     FROM inbound_events
     WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  return {
    id: existing.rows[0]?.id ?? null,
    duplicate: true,
    status: existing.rows[0]?.status ?? null,
    messageId: existing.rows[0]?.message_id ?? null,
    ticketId: existing.rows[0]?.ticket_id ?? null
  };
}

export async function markInboundProcessed({
  id,
  messageId,
  ticketId
}: {
  id: string;
  messageId: string | null;
  ticketId: string | null;
}) {
  await db.query(
    `UPDATE inbound_events
     SET status = 'processed',
         message_id = $2,
         ticket_id = $3,
         updated_at = now()
     WHERE id = $1`,
    [id, messageId, ticketId]
  );
}

export async function markInboundFailed({ id, error }: { id: string; error: string }) {
  await db.query(
    `UPDATE inbound_events
     SET status = 'failed',
         attempt_count = attempt_count + 1,
         last_error = $2,
         next_attempt_at = now() + (INTERVAL '5 minutes' * LEAST(attempt_count + 1, 10)),
         updated_at = now()
     WHERE id = $1`,
    [id, error.slice(0, 500)]
  );
}

export async function lockFailedInboundEvents(limit: number) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE inbound_events
       SET status = 'processing', updated_at = now()
       WHERE id IN (
         SELECT id
         FROM inbound_events
         WHERE status = 'failed'
           AND next_attempt_at <= now()
         ORDER BY next_attempt_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, payload, attempt_count`,
      [limit]
    );
    await client.query("COMMIT");
    return result.rows as Array<{ id: string; payload: Record<string, unknown>; attempt_count: number }>;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
