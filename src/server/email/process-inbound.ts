import { inboundEmailSchema } from "@/server/email/schema";
import {
  computeIdempotencyKey,
  createInboundEvent,
  markInboundFailed,
  markInboundProcessed
} from "@/server/email/inbound-events";
import { normalizeAddressList } from "@/server/email/normalize";
import { storeInboundEmail } from "@/server/email/inbound-store";
import { db } from "@/server/db";
import {
  resolveTenantScope,
  shouldRequireTenantIngressScope,
  type TenantScope,
  type TenantScopeInput
} from "@/server/tenant-context";

type ParsedInboundEmail = typeof inboundEmailSchema._output;
type InboundEmailRoutingCode =
  | "ambiguous_inbound_tenant_route"
  | "unresolved_inbound_tenant_route";

class InboundEmailRoutingError extends Error {
  code: InboundEmailRoutingCode;
  status: number;

  constructor(message: string, code: InboundEmailRoutingCode, status: number) {
    super(message);
    this.name = "InboundEmailRoutingError";
    this.code = code;
    this.status = status;
  }
}

function isInboundEmailRoutingError(error: unknown): error is InboundEmailRoutingError {
  return error instanceof InboundEmailRoutingError;
}

function hasExplicitScope(scopeInput?: TenantScopeInput) {
  return Boolean(scopeInput?.tenantKey?.trim() || scopeInput?.workspaceKey?.trim());
}

function distinctScopes(rows: TenantScope[]) {
  const seen = new Set<string>();
  const scopes: TenantScope[] = [];
  for (const row of rows) {
    const scope = resolveTenantScope(row);
    const key = `${scope.tenantKey}:${scope.workspaceKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push(scope);
  }
  return scopes;
}

async function resolveMailboxScopeForAddresses(addresses: string[]) {
  const normalized = Array.from(
    new Set(addresses.map((address) => address.toLowerCase()).filter(Boolean))
  );
  if (!normalized.length) {
    return null;
  }

  const result = await db.query<{
    tenant_key: string;
    workspace_key: string;
    address: string;
  }>(
    `SELECT tenant_key, workspace_key, lower(address) AS address
     FROM mailboxes
     WHERE lower(address) = ANY($1::text[])
     ORDER BY array_position($1::text[], lower(address)), created_at DESC`,
    [normalized]
  );

  if (!result.rows.length) {
    return null;
  }

  const scopes = distinctScopes(
    result.rows.map((row) => ({
      tenantKey: row.tenant_key,
      workspaceKey: row.workspace_key
    }))
  );
  if (scopes.length > 1) {
    throw new InboundEmailRoutingError(
      "Ambiguous inbound tenant route for recipient addresses.",
      "ambiguous_inbound_tenant_route",
      409
    );
  }
  return scopes[0];
}

export async function resolveInboundEmailScope(
  data: ParsedInboundEmail,
  scopeInput?: TenantScopeInput
) {
  if (hasExplicitScope(scopeInput)) {
    return resolveTenantScope(scopeInput);
  }

  const primaryRecipients = normalizeAddressList(data.to);
  const copiedRecipients = [
    ...normalizeAddressList(data.cc ?? undefined),
    ...normalizeAddressList(data.bcc ?? undefined)
  ];

  const resolvedScope =
    (await resolveMailboxScopeForAddresses(primaryRecipients)) ??
    (await resolveMailboxScopeForAddresses(copiedRecipients));

  if (resolvedScope) {
    return resolvedScope;
  }

  if (shouldRequireTenantIngressScope()) {
    throw new InboundEmailRoutingError(
      "No tenant route matched inbound recipient addresses.",
      "unresolved_inbound_tenant_route",
      404
    );
  }

  return resolveTenantScope();
}

export async function processInboundEmailPayload(payload: unknown, scopeInput?: TenantScopeInput) {
  const parsed = inboundEmailSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Invalid payload", details: parsed.error.flatten() }
    };
  }

  const data = parsed.data;
  let scope: TenantScope;
  try {
    scope = await resolveInboundEmailScope(data, scopeInput);
  } catch (error) {
    if (isInboundEmailRoutingError(error)) {
      return {
        status: error.status,
        body: {
          error:
            error.code === "unresolved_inbound_tenant_route"
              ? "Unresolved inbound tenant route"
              : "Ambiguous inbound tenant route",
          code: error.code,
          details: error.message
        }
      };
    }
    return {
      status: 409,
      body: {
        error: "Ambiguous inbound tenant route",
        details: error instanceof Error ? error.message : "Unable to resolve inbound tenant"
      }
    };
  }
  const idempotencyKey = computeIdempotencyKey(data);
  const inboundEvent = await createInboundEvent({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    idempotencyKey,
    payload: data
  });
  if (inboundEvent.duplicate) {
    return {
      status: 200,
      body: { status: "duplicate", id: inboundEvent.messageId ?? null }
    };
  }

  try {
    const result = await storeInboundEmail(data, scope);
    await markInboundProcessed({
      id: inboundEvent.id,
      messageId: result.messageId,
      ticketId: result.ticketId ?? null,
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey
    });

    return {
      status: 200,
      body: { status: result.status, id: result.messageId, mailboxId: result.mailboxId }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process inbound";
    await markInboundFailed({
      id: inboundEvent.id,
      error: message,
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey
    });
    return {
      status: 500,
      body: { error: "Failed to process inbound", details: message }
    };
  }
}
