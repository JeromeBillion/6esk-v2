import { beforeEach, describe, expect, it, vi } from "vitest";

const TICKET_1 = "11111111-1111-1111-1111-111111111111";
const TICKET_2 = "22222222-2222-2222-2222-222222222222";
const AGENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  recordTicketEvent: vi.fn(),
  addTagsToTicket: vi.fn(),
  removeTagsFromTicket: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/tickets", () => ({
  recordTicketEvent: mocks.recordTicketEvent,
  addTagsToTicket: mocks.addTagsToTicket,
  removeTagsFromTicket: mocks.removeTagsFromTicket
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { PATCH } from "@/app/api/tickets/bulk/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer", id = AGENT_ID) {
  return {
    id,
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

function ticketRow(
  id: string,
  input?: Partial<{ status: "open" | "pending" | "solved" | "closed" | "new"; priority: "low" | "normal" | "high" | "urgent"; assigned_user_id: string | null }>
) {
  return {
    id,
    status: "open",
    priority: "normal",
    assigned_user_id: AGENT_ID,
    ...input
  };
}

async function patchBulk(payload: Record<string, unknown>) {
  const request = new Request("http://localhost/api/tickets/bulk", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await PATCH(request);
  const body = await response.json();
  return { response, body };
}

describe("PATCH /api/tickets/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery.mockReset();
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [ticketRow(TICKET_1), ticketRow(TICKET_2)]
      })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] });
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.addTagsToTicket.mockResolvedValue(undefined);
    mocks.removeTagsFromTicket.mockResolvedValue(undefined);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await patchBulk({
      ticketIds: [TICKET_1],
      status: "pending"
    });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for viewer role", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("viewer"));

    const { response, body } = await patchBulk({
      ticketIds: [TICKET_1],
      status: "pending"
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when any selected ticket does not exist", async () => {
    mocks.dbQuery.mockReset();
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [ticketRow(TICKET_1)]
    });

    const { response, body } = await patchBulk({
      ticketIds: [TICKET_1, TICKET_2],
      status: "pending"
    });

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      error: "Some tickets were not found.",
      missingTicketIds: [TICKET_2]
    });
  });

  it("returns 403 when non-admin tries to update tickets not assigned to them", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent", AGENT_ID));
    mocks.dbQuery.mockReset();
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [ticketRow(TICKET_1, { assigned_user_id: "different-agent-id" })]
    });

    const { response, body } = await patchBulk({
      ticketIds: [TICKET_1],
      status: "pending"
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns 403 when non-admin attempts assignee bulk updates", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent", AGENT_ID));
    mocks.dbQuery.mockReset();
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [ticketRow(TICKET_1, { assigned_user_id: AGENT_ID })]
    });

    const { response, body } = await patchBulk({
      ticketIds: [TICKET_1],
      assignedUserId: null
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("updates status, priority, and tags across selected tickets", async () => {
    const { response, body } = await patchBulk({
      ticketIds: [TICKET_1, TICKET_2],
      status: "pending",
      priority: "high",
      addTags: ["vip", " urgent "],
      removeTags: ["general"]
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "updated",
      updatedCount: 2,
      updatedTicketIds: [TICKET_1, TICKET_2]
    });

    expect(mocks.dbQuery).toHaveBeenCalledTimes(2);
    const [updateSql, updateValues] = mocks.dbQuery.mock.calls[1] ?? [];
    expect(updateSql).toContain("status = $1");
    expect(updateSql).toContain("priority = $2");
    expect(updateValues).toEqual(["pending", "high", [TICKET_1, TICKET_2]]);

    expect(mocks.recordTicketEvent).toHaveBeenCalled();
    expect(mocks.addTagsToTicket).toHaveBeenCalledWith(TICKET_1, ["vip", "urgent"]);
    expect(mocks.addTagsToTicket).toHaveBeenCalledWith(TICKET_2, ["vip", "urgent"]);
    expect(mocks.removeTagsFromTicket).toHaveBeenCalledWith(TICKET_1, ["general"]);
    expect(mocks.removeTagsFromTicket).toHaveBeenCalledWith(TICKET_2, ["general"]);
    expect(mocks.recordAuditLog).toHaveBeenCalledTimes(2);
  });
});
