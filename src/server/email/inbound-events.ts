import { createHash } from "crypto";
import { db } from "@/server/db";
import { normalizeAddressList } from "@/server/email/normalize";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

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
  tenantKey,
  workspaceKey,
  idempotencyKey,
  payload
}: {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  const result = await db.query<{ id: string }>(
    `INSERT INTO inbound_events (tenant_key, workspace_key, idempotency_key, payload, status)
     VALUES ($1, $2, $3, $4, 'processing')
     ON CONFLICT (tenant_key, idempotency_key) DO NOTHING
     RETURNING id`,
    [scope.tenantKey, scope.workspaceKey, idempotencyKey, payload]
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
     WHERE tenant_key = $1
       AND idempotency_key = $2`,
    [scope.tenantKey, idempotencyKey]
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
  ticketId,
  tenantKey,
  workspaceKey
}: {
  id: string;
  messageId: string | null;
  ticketId: string | null;
  tenantKey: string;
  workspaceKey: string;
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  await db.query(
    `UPDATE inbound_events
     SET status = 'processed',
         message_id = $2,
         ticket_id = $3,
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $4
       AND workspace_key = $5`,
    [id, messageId, ticketId, scope.tenantKey, scope.workspaceKey]
  );
}

export async function markInboundFailed({
  id,
  error,
  tenantKey,
  workspaceKey
}: {
  id: string;
  error: string;
  tenantKey: string;
  workspaceKey: string;
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  await db.query(
    `UPDATE inbound_events
     SET status = 'failed',
         attempt_count = attempt_count + 1,
         last_error = $2,
         next_attempt_at = now() + (INTERVAL '5 minutes' * LEAST(attempt_count + 1, 10)),
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $3
       AND workspace_key = $4`,
    [id, error.slice(0, 500), scope.tenantKey, scope.workspaceKey]
  );
}

export async function lockFailedInboundEvents(limit: number, scopeInput?: TenantScopeInput) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
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
           ${scope ? "AND tenant_key = $2" : ""}
           ${scope ? "AND workspace_key = $3" : ""}
           AND next_attempt_at <= now()
         ORDER BY next_attempt_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, tenant_key, workspace_key, payload, attempt_count`,
      scope ? [limit, scope.tenantKey, scope.workspaceKey] : [limit]
    );
    await client.query("COMMIT");
    return result.rows as Array<{
      id: string;
      tenant_key: string;
      workspace_key: string;
      payload: Record<string, unknown>;
      attempt_count: number;
    }>;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
