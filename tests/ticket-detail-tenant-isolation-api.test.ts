import { beforeEach, describe, expect, it, vi } from "vitest";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTicketById: vi.fn(),
  listTicketMessages: vi.fn(),
  listTicketEvents: vi.fn(),
  recordTicketEvent: vi.fn(),
  listDraftsForTicket: vi.fn(),
  listAuditLogsForTicket: vi.fn(),
  listLinkedTickets: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/tickets", () => ({
  getTicketById: mocks.getTicketById,
  listTicketMessages: mocks.listTicketMessages,
  listTicketEvents: mocks.listTicketEvents,
  recordTicketEvent: mocks.recordTicketEvent
}));

vi.mock("@/server/agents/drafts", () => ({
  listDraftsForTicket: mocks.listDraftsForTicket
}));

vi.mock("@/server/audit", () => ({
  listAuditLogsForTicket: mocks.listAuditLogsForTicket
}));

vi.mock("@/server/merges", () => ({
  listLinkedTickets: mocks.listLinkedTickets
}));

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  enqueueAgentEvent: mocks.enqueueAgentEvent,
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { GET, PATCH } from "@/app/api/tickets/[ticketId]/route";

function buildUser() {
  return {
    id: USER_ID,
    email: "tenant-admin@example.com",
    display_name: "Tenant Admin",
    role_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    role_name: "tenant_admin",
    tenant_id: TENANT_A
  };
}

function buildTicket(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: TICKET_ID,
    tenant_id: TENANT_A,
    mailbox_id: "mailbox-1",
    status: "open",
    priority: "normal",
    assigned_user_id: null,
    ...overrides
  };
}

async function getTicketDetail() {
  const response = await GET(new Request(`http://localhost/api/tickets/${TICKET_ID}`), {
    params: Promise.resolve({ ticketId: TICKET_ID })
  });
  const body = await response.json();
  return { response, body };
}

async function patchTicket(payload: Record<string, unknown>) {
  const response = await PATCH(
    new Request(`http://localhost/api/tickets/${TICKET_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }),
    {
      params: Promise.resolve({ ticketId: TICKET_ID })
    }
  );
  const body = await response.json();
  return { response, body };
}

describe("ticket detail tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.getTicketById.mockResolvedValue(buildTicket());
    mocks.listTicketMessages.mockResolvedValue([]);
    mocks.listTicketEvents.mockResolvedValue([]);
    mocks.listDraftsForTicket.mockResolvedValue([]);
    mocks.listAuditLogsForTicket.mockResolvedValue([]);
    mocks.listLinkedTickets.mockResolvedValue([]);
    mocks.buildAgentEvent.mockReturnValue({ event_id: "evt-1" });
    mocks.enqueueAgentEvent.mockResolvedValue("outbox-1");
    mocks.deliverPendingAgentEvents.mockResolvedValue({ delivered: 0, skipped: 0, limitUsed: 0 });
    mocks.dbQuery.mockResolvedValue({ rows: [{ id: TICKET_ID }] });
  });

  it("treats a ticket outside the session tenant as not found and does not load child records", async () => {
    mocks.getTicketById.mockResolvedValue(null);

    const { response, body } = await getTicketDetail();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: "Not found" });
    expect(mocks.getTicketById).toHaveBeenCalledWith(TICKET_ID, TENANT_A);
    expect(mocks.listTicketMessages).not.toHaveBeenCalled();
    expect(mocks.listTicketEvents).not.toHaveBeenCalled();
    expect(mocks.listDraftsForTicket).not.toHaveBeenCalled();
    expect(mocks.listAuditLogsForTicket).not.toHaveBeenCalled();
    expect(mocks.listLinkedTickets).not.toHaveBeenCalled();
  });

  it("loads the ticket object graph with the session tenant boundary", async () => {
    const { response, body } = await getTicketDetail();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ticket: expect.objectContaining({ id: TICKET_ID }) });
    expect(mocks.getTicketById).toHaveBeenCalledWith(TICKET_ID, TENANT_A);
    expect(mocks.listTicketMessages).toHaveBeenCalledWith(TICKET_ID, TENANT_A);
    expect(mocks.listTicketEvents).toHaveBeenCalledWith(TICKET_ID, TENANT_A);
    expect(mocks.listDraftsForTicket).toHaveBeenCalledWith(TICKET_ID, TENANT_A);
    expect(mocks.listAuditLogsForTicket).toHaveBeenCalledWith(TICKET_ID, TENANT_A, 50);
    expect(mocks.listLinkedTickets).toHaveBeenCalledWith(TICKET_ID, TENANT_A);
  });

  it("scopes ticket updates and follow-up events to the session tenant", async () => {
    mocks.getTicketById
      .mockResolvedValueOnce(buildTicket({ status: "open" }))
      .mockResolvedValueOnce(buildTicket({ status: "solved" }));

    const { response, body } = await patchTicket({ status: "solved" });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ticket: expect.objectContaining({ status: "solved" }) });
    expect(mocks.getTicketById).toHaveBeenNthCalledWith(1, TICKET_ID, TENANT_A);
    expect(mocks.getTicketById).toHaveBeenNthCalledWith(2, TICKET_ID, TENANT_A);

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE id = $");
    expect(sql).toContain("AND tenant_id = $");
    expect(values).toContain(TICKET_ID);
    expect(values).toContain(TENANT_A);
    expect(mocks.recordTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        ticketId: TICKET_ID,
        eventType: "status_updated"
      })
    );
  });
});
