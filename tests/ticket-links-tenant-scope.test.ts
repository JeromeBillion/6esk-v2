import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";
const SOURCE_TICKET_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_TICKET_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  runInBackground: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents,
  enqueueAgentEvent: mocks.enqueueAgentEvent
}));

vi.mock("@/server/async", () => ({
  runInBackground: mocks.runInBackground
}));

vi.mock("@/server/logger", () => ({
  logger: {
    error: mocks.loggerError
  }
}));

import {
  linkTickets,
  listLinkedTickets,
  preflightTicketLink
} from "@/server/merges";

function buildTicket(id: string) {
  return {
    id,
    tenant_id: TENANT_ID,
    customer_id: null,
    merged_into_ticket_id: null,
    mailbox_id: "mailbox-1",
    requester_email: id === SOURCE_TICKET_ID ? "source@example.com" : "target@example.com",
    subject: id === SOURCE_TICKET_ID ? "Source" : "Target",
    status: "open",
    priority: "normal",
    assigned_user_id: null
  };
}

function setupClient() {
  mocks.clientQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM tickets") && sql.includes("id = ANY") && sql.includes("FOR UPDATE")) {
      return Promise.resolve({
        rowCount: 2,
        rows: [buildTicket(SOURCE_TICKET_ID), buildTicket(TARGET_TICKET_ID)]
      });
    }
    if (sql.includes("FROM tickets") && sql.includes("id = ANY")) {
      return Promise.resolve({
        rowCount: 2,
        rows: [buildTicket(SOURCE_TICKET_ID), buildTicket(TARGET_TICKET_ID)]
      });
    }
    if (sql.includes("AS has_whatsapp")) {
      return Promise.resolve({ rows: [{ has_whatsapp: false, has_voice: false }], rowCount: 1 });
    }
    if (sql.includes("FROM ticket_links") && sql.includes("SELECT id")) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (sql.includes("INSERT INTO ticket_links")) {
      return Promise.resolve({ rows: [{ id: "link-1" }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  mocks.dbConnect.mockResolvedValue({
    query: mocks.clientQuery,
    release: mocks.clientRelease
  });
  mocks.buildAgentEvent.mockReturnValue({ eventType: "ticket.linked_case" });
  mocks.enqueueAgentEvent.mockResolvedValue("outbox-1");
  mocks.deliverPendingAgentEvents.mockResolvedValue({ delivered: 0, skipped: 0, limitUsed: 0 });
}

describe("ticket links tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupClient();
  });

  it("rejects linked-ticket listing without tenant scope before querying", async () => {
    await expect(listLinkedTickets(SOURCE_TICKET_ID, "")).rejects.toThrow("tenantId is required");

    expect(mocks.dbConnect).not.toHaveBeenCalled();
  });

  it("lists linked tickets through tenant-pinned link, ticket, and message predicates", async () => {
    await listLinkedTickets(SOURCE_TICKET_ID, TENANT_ID);

    const [sql, values] = mocks.clientQuery.mock.calls[0] ?? [];
    expect(sql).toContain("FROM ticket_links tl");
    expect(sql).toContain("tl.tenant_id = $2");
    expect(sql).toContain("linked.tenant_id = $2");
    expect(sql).toContain("msg.tenant_id = $2");
    expect(values).toEqual([SOURCE_TICKET_ID, TENANT_ID]);
  });

  it("rejects link preflight without tenant scope before querying", async () => {
    await expect(
      preflightTicketLink({
        tenantId: null,
        sourceTicketId: SOURCE_TICKET_ID,
        targetTicketId: TARGET_TICKET_ID
      })
    ).rejects.toThrow("tenantId is required");

    expect(mocks.dbConnect).not.toHaveBeenCalled();
  });

  it("preflights ticket links inside the caller tenant", async () => {
    await preflightTicketLink({
      tenantId: TENANT_ID,
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID
    });

    const [ticketSql, ticketValues] = mocks.clientQuery.mock.calls[0] ?? [];
    expect(ticketSql).toContain("AND tenant_id = $2");
    expect(ticketValues).toEqual([[SOURCE_TICKET_ID, TARGET_TICKET_ID], TENANT_ID]);

    const existingLinkCall = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FROM ticket_links")
    );
    expect(existingLinkCall?.[0]).toContain("WHERE tenant_id = $1");
    expect(existingLinkCall?.[1]?.[0]).toBe(TENANT_ID);
  });

  it("rejects ticket linking without tenant scope before querying", async () => {
    await expect(
      linkTickets({
        tenantId: "",
        sourceTicketId: SOURCE_TICKET_ID,
        targetTicketId: TARGET_TICKET_ID
      })
    ).rejects.toThrow("tenantId is required");

    expect(mocks.dbConnect).not.toHaveBeenCalled();
  });

  it("writes linked cases under tenant-owned link rows", async () => {
    await linkTickets({
      tenantId: TENANT_ID,
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      actorUserId: "user-1",
      reason: "Same case"
    });

    const lockCall = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FOR UPDATE")
    );
    expect(lockCall?.[0]).toContain("AND tenant_id = $2");
    expect(lockCall?.[1]).toEqual([[SOURCE_TICKET_ID, TARGET_TICKET_ID], TENANT_ID]);

    const insertCall = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO ticket_links")
    );
    expect(insertCall?.[0]).toContain("tenant_id");
    expect(insertCall?.[1]?.slice(0, 3)).toEqual([
      TENANT_ID,
      SOURCE_TICKET_ID,
      TARGET_TICKET_ID
    ]);
  });
});
