import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { buildAgentCustomerContext } from "../src/server/agents/customer-context";

describe("agent customer context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("builds a source-bound same-customer context under tenant and workspace scope", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "ticket-active",
            customer_id: "customer-1",
            requester_email: "customer@example.com",
            mailbox_id: "mailbox-1",
            metadata: {}
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ticket-active" }, { id: "ticket-prior" }] });

    const context = await buildAgentCustomerContext({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      eventType: "ticket.message.created",
      payload: {
        resource: {
          ticket_id: "ticket-active",
          message_id: "message-1",
          mailbox_id: "mailbox-1"
        },
        conversation_ref: "thread-1"
      }
    });

    expect(context).toMatchObject({
      schema_version: "agent-customer-context.v1",
      tenant_key: "tenant-a",
      workspace_key: "workspace-a",
      channel: "email",
      active_ticket_id: "ticket-active",
      active_thread_id: "thread-1",
      current_customer_id: "customer-1",
      ambiguity_state: "resolved"
    });
    expect(context.allowed_source_ids.ticket_ids).toEqual(["ticket-active", "ticket-prior"]);
    expect(context.allowed_source_ids.customer_ids).toEqual(["customer-1"]);
    expect(context.allowed_source_ids.message_ids).toEqual(["message-1"]);

    const [ticketSql, ticketValues] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(ticketSql).toContain("AND workspace_key = $3");
    expect(ticketValues).toEqual(["ticket-active", "tenant-a", "workspace-a"]);
  });

  it("marks conflicted identity context as unsafe for history expansion", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "ticket-active",
            customer_id: "customer-1",
            requester_email: "whatsapp:+15550000001",
            mailbox_id: "mailbox-1",
            metadata: { external_profile_lookup: { status: "conflicted" } }
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const context = await buildAgentCustomerContext({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      eventType: "ticket.message.created",
      payload: {
        resource: {
          ticket_id: "ticket-active",
          mailbox_id: "mailbox-1"
        }
      }
    });

    expect(context.channel).toBe("whatsapp");
    expect(context.ambiguity_state).toBe("conflicted");
    expect(context.current_customer_id).toBeNull();
    expect(context.same_customer_history_ticket_ids).toEqual([]);
    expect(context.allowed_source_ids.ticket_ids).toEqual(["ticket-active"]);
  });
});
