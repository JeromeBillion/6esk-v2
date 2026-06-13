import { db } from "@/server/db";
import type {
  AgentOutputCustomerChannel,
  AgentOutputCustomerContext,
  AgentOutputCustomerContextState
} from "@/server/agents/output-validator";

type TicketContextRow = {
  id: string;
  customer_id: string | null;
  requester_email: string | null;
  mailbox_id: string | null;
  metadata: Record<string, unknown> | null;
};

type BuildAgentCustomerContextInput = {
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
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
  return readString(customer?.id) ?? readString(payload.customer_id) ?? readString(payload.customerId);
}

function readActiveThreadId(payload: Record<string, unknown>) {
  const call = asRecord(payload.call);
  return (
    readString(payload.conversation_ref) ??
    readString(payload.thread_id) ??
    readString(payload.threadId) ??
    readString(call?.id)
  );
}

function readResource(payload: Record<string, unknown>) {
  return asRecord(payload.resource) ?? {};
}

function readResourceTicketId(payload: Record<string, unknown>, resource: Record<string, unknown>) {
  const resourceType = (readString(payload.resourceType) ?? readString(payload.resource_type))?.toLowerCase();
  const resourceId = readString(payload.resourceId) ?? readString(payload.resource_id);
  if (resourceType === "ticket" && resourceId) {
    return resourceId;
  }
  return (
    readString(resource.ticket_id) ??
    readString(resource.ticketId) ??
    readString(payload.ticket_id) ??
    readString(payload.ticketId)
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
}): AgentOutputCustomerChannel {
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
  tenantId: string;
}) {
  const result = await db.query<TicketContextRow>(
    `SELECT id, customer_id, requester_email, mailbox_id, metadata
     FROM tickets
     WHERE id = $1
       AND tenant_id = $2
     LIMIT 1`,
    [input.ticketId, input.tenantId]
  );
  return result.rows[0] ?? null;
}

async function customerExists(input: {
  customerId: string;
  tenantId: string;
}) {
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM customers
     WHERE id = $1
       AND tenant_id = $2
       AND merged_into_customer_id IS NULL
     LIMIT 1`,
    [input.customerId, input.tenantId]
  );
  return Boolean(result.rows[0]);
}

async function hasIdentityConflictEvent(input: {
  ticketId: string;
  tenantId: string;
}) {
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM ticket_events
     WHERE ticket_id = $1
       AND tenant_id = $2
       AND event_type = 'customer_identity_conflict'
     LIMIT 1`,
    [input.ticketId, input.tenantId]
  );
  return Boolean(result.rows[0]);
}

async function listSameCustomerTicketIds(input: {
  customerId: string;
  tenantId: string;
}) {
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM tickets
     WHERE tenant_id = $1
       AND customer_id = $2
       AND merged_into_ticket_id IS NULL
     ORDER BY updated_at DESC, id DESC
     LIMIT 50`,
    [input.tenantId, input.customerId]
  );
  return result.rows.map((row) => row.id);
}

export async function buildAgentCustomerContext(
  input: BuildAgentCustomerContextInput
): Promise<AgentOutputCustomerContext> {
  const resource = readResource(input.payload);
  const activeTicketId = readResourceTicketId(input.payload, resource);
  const activeMessageId =
    readString(resource.message_id) ?? readString(resource.messageId) ?? readString(input.payload.message_id);
  const mailboxId =
    readString(resource.mailbox_id) ?? readString(resource.mailboxId) ?? readString(input.payload.mailbox_id);
  const activeThreadId = readActiveThreadId(input.payload);
  const payloadCustomerId = readPayloadCustomerId(input.payload);

  const ticket = activeTicketId
    ? await findTicketContext({
        ticketId: activeTicketId,
        tenantId: input.tenantId
      })
    : null;

  const ticketCustomerId = ticket?.customer_id ?? null;
  const payloadCustomerExists = !ticketCustomerId && payloadCustomerId
    ? await customerExists({
        customerId: payloadCustomerId,
        tenantId: input.tenantId
      })
    : false;
  const customerId = ticketCustomerId ?? (payloadCustomerExists ? payloadCustomerId : null);

  const conflict =
    readConflictSignal(input.payload, ticket?.metadata) ||
    Boolean(ticketCustomerId && payloadCustomerId && ticketCustomerId !== payloadCustomerId) ||
    Boolean(
      activeTicketId &&
        (await hasIdentityConflictEvent({
          ticketId: activeTicketId,
          tenantId: input.tenantId
        }))
    );

  const ambiguityState: AgentOutputCustomerContextState = conflict
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
          tenantId: input.tenantId
        })
      : [];

  const allowedTicketIds =
    ambiguityState === "resolved"
      ? unique([activeTicketId, ...sameCustomerHistoryTicketIds])
      : unique([activeTicketId]);

  return {
    schemaVersion: "agent-customer-output-context.v1",
    channel: inferChannel({
      eventType: input.eventType,
      payload: input.payload,
      ticket
    }),
    activeTicketId: activeTicketId ?? null,
    activeThreadId: activeThreadId ?? null,
    currentCustomerId: ambiguityState === "resolved" ? customerId : null,
    ambiguityState,
    allowedSourceIds: {
      ticketIds: allowedTicketIds,
      customerIds: ambiguityState === "resolved" && customerId ? [customerId] : [],
      messageIds: unique([activeMessageId]),
      mailboxIds: unique([mailboxId ?? ticket?.mailbox_id]),
      threadIds: unique([activeThreadId])
    },
    sameCustomerHistoryTicketIds,
    customerVisibleProfileFields: ["display_name"],
    profilePiiPolicy: "minimize",
    disallowedScopeExpansion: [
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
