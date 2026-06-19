import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  createTicket,
  listTicketsForUser,
  recordTicketEvent,
  resolveTicketIdForInbound
} from "@/server/tickets";

describe("listTicketsForUser", () => {
  const tenantId = "99999999-9999-4999-8999-999999999999";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("limits support queues to platform mailboxes", async () => {
    const user = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "jerome.choma@6ex.co.za",
      display_name: "Jerome",
      role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      role_name: "lead_admin",
      tenant_id: tenantId
    };

    await listTicketsForUser(user, {});

    const [sql] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("LEFT JOIN mailboxes mb ON mb.id = t.mailbox_id");
    expect(sql).toContain("(t.mailbox_id IS NULL OR mb.type = 'platform')");
    expect(sql).toContain("t.tenant_id = $1");
    expect(mocks.dbQuery.mock.calls[0]?.[1]).toEqual([tenantId]);
  });

  it("fails closed without tenant scope", async () => {
    const user = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "jerome.choma@6ex.co.za",
      display_name: "Jerome",
      role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      role_name: "lead_admin",
      tenant_id: null
    };

    const result = await listTicketsForUser(user, {});

    expect(result).toEqual([]);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("does not resolve inbound ticket references without tenant scope", async () => {
    const result = await resolveTicketIdForInbound(["<message@example.com>"], "");

    expect(result).toBeNull();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects ticket creation without tenant scope", async () => {
    await expect(
      createTicket({
        tenantId: "",
        mailboxId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        requesterEmail: "customer@example.com",
        subject: "Missing tenant"
      })
    ).rejects.toThrow("Create ticket requires tenantId");

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects ticket events without tenant scope", async () => {
    await expect(
      recordTicketEvent({
        tenantId: "",
        ticketId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        eventType: "ticket_created"
      })
    ).rejects.toThrow("Record ticket event requires tenantId");

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
