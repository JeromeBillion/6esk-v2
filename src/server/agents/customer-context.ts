import { db } from "@/server/db";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

export type AgentCustomerContextState = "resolved" | "unresolved" | "ambiguous" | "conflicted";
export type AgentCustomerChannel = "email" | "whatsapp" | "voice" | "webchat" | "unknown";

export type AgentCustomerContext = {
  schema_version: "agent-customer-context.v1";
  tenant_key: string;
  workspace_key: string;
  channel: AgentCustomerChannel;
  active_ticket_id: string | null;
  active_thread_id: string | null;
  current_customer_id: string | null;
  ambiguity_state: AgentCustomerContextState;
  allowed_source_ids: {
    ticket_ids: string[];
    customer_ids: string[];
    message_ids: string[];
    mailbox_ids: string[];
    thread_ids: string[];
  };
  same_customer_history_ticket_ids: string[];
  customer_visible_profile_fields: string[];
  profile_pii_policy: "minimize";
  disallowed_scope_expansion: string[];
};

type BuildAgentCustomerContextInput = {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
};

type TicketContextRow = {
  id: string;
  customer_id: string | null;
  requester_email: string | null;
  mailbox_id: string | null;
  metadata: Record<string, unknown> | null;
};

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function readPayloadCustomerId(payload: Record<string, unknown>) {
  const customer = asRecord(payload.customer);
  return (
    readString(customer?.id) ??
    readString(payload.customer_id) ??
    readString(payload.customerId) ??
    null
  );
}

function readActiveThreadId(payload: Record<string, unknown>) {
  const call = asRecord(payload.call);
  return (
    readString(payload.conversation_ref) ??
    readString(payload.thread_id) ??
    readString(payload.threadId) ??
    readString(call?.id) ??
    null
  );
}

function readConflictSignal(payload: Record<string, unknown>, ticketMetadata?: Record<string, unknown> | null) {
  if (asRecord(payload.conflict)) return true;
  const lookup = asRecord(ticketMetadata?.external_profile_lookup);
  const profileConflict = asRecord(ticketMetadata?.external_profile_conflict);
  return lookup?.status === "conflicted" || Boolean(lookup?.conflict) || Boolean(profileConflict);
}

function inferChannel(input: {
  eventType: string;
  payload: Record<string, unknown>;
  ticket?: TicketContextRow | null;
}): AgentCustomerChannel {
  const explicit = readString(input.payload.channel)?.toLowerCase();
  if (explicit === "email" || explicit === "whatsapp" || explicit === "voice" || explicit === "webchat") {
    return explicit;
  }
  if (input.eventType.includes("call") || asRecord(input.payload.call)) return "voice";
  const requester = input.ticket?.requester_email?.toLowerCase() ?? "";
  if (requester.startsWith("whatsapp:")) return "whatsapp";
  if (requester.startsWith("voice:")) return "voice";
  if (requester) return "email";
  return "unknown";
}

async function findTicketContext(input: {
  ticketId: string;
  tenantKey: string;
  workspaceKey: string;
}) {
  const result = await db.query<TicketContextRow>(
    `SELECT id, customer_id, requester_email, mailbox_id, metadata
     FROM tickets
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
     LIMIT 1`,
    [input.ticketId, input.tenantKey, input.workspaceKey]
  );
  return result.rows[0] ?? null;
}

async function customerExists(input: {
  customerId: string;
  tenantKey: string;
  workspaceKey: string;
}) {
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM customers
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
       AND merged_into_customer_id IS NULL
     LIMIT 1`,
    [input.customerId, input.tenantKey, input.workspaceKey]
  );
  return Boolean(result.rows[0]);
}

async function hasIdentityConflictEvent(input: {
  ticketId: string;
  tenantKey: string;
  workspaceKey: string;
}) {
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM ticket_events
     WHERE ticket_id = $1
       AND tenant_key = $2
       AND workspace_key = $3
       AND event_type = 'customer_identity_conflict'
     LIMIT 1`,
    [input.ticketId, input.tenantKey, input.workspaceKey]
  );
  return Boolean(result.rows[0]);
}

async function listSameCustomerTicketIds(input: {
  customerId: string;
  tenantKey: string;
  workspaceKey: string;
}) {
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM tickets
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND customer_id = $3
       AND merged_into_ticket_id IS NULL
     ORDER BY updated_at DESC, id DESC
     LIMIT 50`,
    [input.tenantKey, input.workspaceKey, input.customerId]
  );
  return result.rows.map((row) => row.id);
}

export async function buildAgentCustomerContext(
  input: BuildAgentCustomerContextInput
): Promise<AgentCustomerContext> {
  const scope = resolveTenantScope({
    tenantKey: input.tenantKey,
    workspaceKey: input.workspaceKey
  } satisfies TenantScopeInput);
  const resource = asRecord(input.payload.resource);
  const activeTicketId = readString(resource?.ticket_id);
  const activeMessageId = readString(resource?.message_id);
  const mailboxId = readString(resource?.mailbox_id);
  const activeThreadId = readActiveThreadId(input.payload);
  const payloadCustomerId = readPayloadCustomerId(input.payload);

  const ticket = activeTicketId
    ? await findTicketContext({
        ticketId: activeTicketId,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey
      })
    : null;

  const ticketCustomerId = ticket?.customer_id ?? null;
  const customerId =
    ticketCustomerId ??
    (payloadCustomerId &&
    (await customerExists({
      customerId: payloadCustomerId,
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey
    }))
      ? payloadCustomerId
      : null);

  const conflict =
    readConflictSignal(input.payload, ticket?.metadata) ||
    Boolean(ticketCustomerId && payloadCustomerId && ticketCustomerId !== payloadCustomerId) ||
    Boolean(
      activeTicketId &&
        (await hasIdentityConflictEvent({
          ticketId: activeTicketId,
          tenantKey: scope.tenantKey,
          workspaceKey: scope.workspaceKey
        }))
    );

  const ambiguityState: AgentCustomerContextState = conflict
    ? "conflicted"
    : customerId
      ? "resolved"
      : activeTicketId
        ? "unresolved"
        : "ambiguous";

  const sameCustomerHistoryTicketIds =
    ambiguityState === "resolved" && customerId
      ? await listSameCustomerTicketIds({
          customerId,
          tenantKey: scope.tenantKey,
          workspaceKey: scope.workspaceKey
        })
      : [];

  const allowedTicketIds =
    ambiguityState === "resolved"
      ? unique([activeTicketId, ...sameCustomerHistoryTicketIds])
      : unique([activeTicketId]);

  return {
    schema_version: "agent-customer-context.v1",
    tenant_key: scope.tenantKey,
    workspace_key: scope.workspaceKey,
    channel: inferChannel({
      eventType: input.eventType,
      payload: input.payload,
      ticket
    }),
    active_ticket_id: activeTicketId ?? null,
    active_thread_id: activeThreadId ?? null,
    current_customer_id: ambiguityState === "resolved" ? customerId : null,
    ambiguity_state: ambiguityState,
    allowed_source_ids: {
      ticket_ids: allowedTicketIds,
      customer_ids: ambiguityState === "resolved" && customerId ? [customerId] : [],
      message_ids: unique([activeMessageId]),
      mailbox_ids: unique([mailboxId ?? ticket?.mailbox_id]),
      thread_ids: unique([activeThreadId])
    },
    same_customer_history_ticket_ids: sameCustomerHistoryTicketIds,
    customer_visible_profile_fields: ["display_name"],
    profile_pii_policy: "minimize",
    disallowed_scope_expansion: [
      "other_customer",
      "other_tenant",
      "other_workspace",
      "mailbox_wide_history",
      "analytics_wide_history",
      "raw_database",
      "hidden_runtime_state"
    ]
  };
}
