import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TICKET_ID = "11111111-1111-4111-8111-111111111111";
const PRIOR_TICKET_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { buildAgentCustomerContext } from "@/server/agents/customer-context";

describe("buildAgentCustomerContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("builds a source-bound same-customer context under tenant scope", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: TICKET_ID,
            customer_id: CUSTOMER_ID,
            requester_email: "customer@example.com",
            mailbox_id: "mailbox-1",
            metadata: {}
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }, { id: PRIOR_TICKET_ID }] });

    const context = await buildAgentCustomerContext({
      tenantId: TENANT_ID,
      eventType: "ticket.message.created",
      payload: {
        resource: {
          ticket_id: TICKET_ID,
          message_id: "message-1",
          mailbox_id: "mailbox-1"
        },
        conversation_ref: "thread-1"
      }
    });

    expect(context).toMatchObject({
      schemaVersion: "agent-customer-output-context.v1",
      channel: "email",
      activeTicketId: TICKET_ID,
      activeThreadId: "thread-1",
      currentCustomerId: CUSTOMER_ID,
      ambiguityState: "resolved",
      profilePiiPolicy: "minimize"
    });
    expect(context.allowedSourceIds?.ticketIds).toEqual([TICKET_ID, PRIOR_TICKET_ID]);
    expect(context.allowedSourceIds?.customerIds).toEqual([CUSTOMER_ID]);
    expect(context.allowedSourceIds?.messageIds).toEqual(["message-1"]);

    const [ticketSql, ticketValues] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(String(ticketSql)).toContain("WHERE id = $1");
    expect(String(ticketSql)).toContain("AND tenant_id = $2");
    expect(ticketValues).toEqual([TICKET_ID, TENANT_ID]);
  });

  it("accepts top-level ticket resource payloads without widening scope", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: TICKET_ID,
            customer_id: CUSTOMER_ID,
            requester_email: "customer@example.com",
            mailbox_id: "mailbox-1",
            metadata: {}
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: TICKET_ID }] });

    const context = await buildAgentCustomerContext({
      tenantId: TENANT_ID,
      eventType: "agent.run.replay",
      payload: {
        resourceType: "ticket",
        resourceId: TICKET_ID,
        message_id: "message-1",
        mailbox_id: "mailbox-1"
      }
    });

    expect(context).toMatchObject({
      activeTicketId: TICKET_ID,
      currentCustomerId: CUSTOMER_ID,
      ambiguityState: "resolved"
    });
    expect(context.allowedSourceIds?.messageIds).toEqual(["message-1"]);
    expect(context.allowedSourceIds?.mailboxIds).toEqual(["mailbox-1"]);
  });

  it("marks conflicted identity context unsafe for history expansion", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: TICKET_ID,
          customer_id: CUSTOMER_ID,
          requester_email: "whatsapp:+15550000001",
          mailbox_id: "mailbox-1",
          metadata: { external_profile_lookup: { status: "conflicted" } }
        }
      ]
    });

    const context = await buildAgentCustomerContext({
      tenantId: TENANT_ID,
      eventType: "ticket.message.created",
      payload: {
        resource: {
          ticket_id: TICKET_ID,
          mailbox_id: "mailbox-1"
        }
      }
    });

    expect(context.channel).toBe("whatsapp");
    expect(context.ambiguityState).toBe("conflicted");
    expect(context.currentCustomerId).toBeNull();
    expect(context.sameCustomerHistoryTicketIds).toEqual([]);
    expect(context.allowedSourceIds?.ticketIds).toEqual([TICKET_ID]);
  });

  it("returns ambiguous context without widening scope when no ticket is present", async () => {
    const context = await buildAgentCustomerContext({
      tenantId: TENANT_ID,
      eventType: "tenant.health.check",
      payload: {}
    });

    expect(context).toMatchObject({
      channel: "unknown",
      activeTicketId: null,
      currentCustomerId: null,
      ambiguityState: "ambiguous"
    });
    expect(context.allowedSourceIds?.ticketIds).toEqual([]);
    expect(context.disallowedScopeExpansion).toContain("other_customer");
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
