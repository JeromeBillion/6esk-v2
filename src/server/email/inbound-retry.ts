import { inboundEmailSchema } from "@/server/email/schema";
import { storeInboundEmail } from "@/server/email/inbound-store";
import { lockFailedInboundEvents, markInboundFailed, markInboundProcessed } from "@/server/email/inbound-events";
import { db } from "@/server/db";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

type RetryInboundInput = {
  limit?: number;
  eventIds?: string[];
};

async function lockSpecificFailedInboundEvents(eventIds: string[], scopeInput?: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
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
       AND tenant_key = $2
       AND workspace_key = $3
       AND id::text = ANY($1::text[])
     RETURNING id, tenant_key, workspace_key, payload, attempt_count`,
    [normalizedIds, scope.tenantKey, scope.workspaceKey]
  );
  return result.rows as Array<{
    id: string;
    tenant_key: string;
    workspace_key: string;
    payload: Record<string, unknown>;
    attempt_count: number;
  }>;
}

export async function retryFailedInboundEvents(input: RetryInboundInput = {}, scopeInput?: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const targetIds = Array.isArray(input.eventIds) ? input.eventIds : [];
  const events =
    targetIds.length > 0
      ? await lockSpecificFailedInboundEvents(targetIds, scope)
      : await lockFailedInboundEvents(limit, scope);
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
        error: "Stored payload is invalid for inbound schema",
        tenantKey: event.tenant_key,
        workspaceKey: event.workspace_key
      });
      failed += 1;
      continue;
    }

    try {
      const result = await storeInboundEmail(parsed.data, {
        tenantKey: event.tenant_key,
        workspaceKey: event.workspace_key
      });
      await markInboundProcessed({
        id: event.id,
        messageId: result.messageId,
        ticketId: result.ticketId ?? null,
        tenantKey: event.tenant_key,
        workspaceKey: event.workspace_key
      });
      retried += 1;
      successfulIds.push(event.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process inbound";
      await markInboundFailed({
        id: event.id,
        error: message,
        tenantKey: event.tenant_key,
        workspaceKey: event.workspace_key
      });
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
