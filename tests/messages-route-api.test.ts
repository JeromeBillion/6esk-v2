import { beforeEach, describe, expect, it, vi } from "vitest";

const MESSAGE_ID = "11111111-1111-1111-1111-111111111111";
const THREAD_ID = "thread-123";
const TENANT_ID = "99999999-9999-4999-8999-999999999999";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getMessageById: vi.fn(),
  getTicketAssignment: vi.fn(),
  hasMailboxAccess: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/messages", () => ({
  getMessageById: mocks.getMessageById,
  getTicketAssignment: mocks.getTicketAssignment,
  hasMailboxAccess: mocks.hasMailboxAccess
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { PATCH } from "@/app/api/messages/[messageId]/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: TENANT_ID
  };
}

function buildMessage(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: MESSAGE_ID,
    mailbox_id: "mailbox-1",
    ticket_id: null,
    thread_id: THREAD_ID,
    ...overrides
  };
}

async function patchMessage(payload: Record<string, unknown>) {
  const request = new Request(`http://localhost/api/messages/${MESSAGE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await PATCH(request, { params: Promise.resolve({ messageId: MESSAGE_ID }) });
  const body = await response.json();
  return { response, body };
}

describe("PATCH /api/messages/[messageId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.getMessageById.mockResolvedValue(buildMessage());
    mocks.getTicketAssignment.mockResolvedValue(null);
    mocks.hasMailboxAccess.mockResolvedValue(true);
    mocks.dbQuery.mockResolvedValue({
      rows: [{ id: MESSAGE_ID }, { id: "22222222-2222-2222-2222-222222222222" }]
    });
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await patchMessage({ isRead: true });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.getMessageById).not.toHaveBeenCalled();
  });

  it("returns 403 when non-admin user has no mailbox access", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.getMessageById.mockResolvedValue(buildMessage({ ticket_id: null }));
    mocks.hasMailboxAccess.mockResolvedValue(false);

    const { response, body } = await patchMessage({ isRead: true });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.hasMailboxAccess).toHaveBeenCalledWith("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "mailbox-1", TENANT_ID);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 403 when non-admin user is not assigned to ticket messages", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.getMessageById.mockResolvedValue(buildMessage({ ticket_id: "ticket-1" }));
    mocks.getTicketAssignment.mockResolvedValue("different-agent");

    const { response, body } = await patchMessage({ isRead: true });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.getTicketAssignment).toHaveBeenCalledWith("ticket-1", TENANT_ID);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when no update fields are provided", async () => {
    const { response, body } = await patchMessage({});

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "No updates provided" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("updates thread read state across all messages in the thread", async () => {
    const { response, body } = await patchMessage({ isRead: true });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      updatedIds: [MESSAGE_ID, "22222222-2222-2222-2222-222222222222"]
    });
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("is_read = $1");
    expect(sql).toContain("WHERE (thread_id = $2 OR id = $3)");
    expect(sql).toContain("AND tenant_id = $5");
    expect(values).toEqual([true, THREAD_ID, MESSAGE_ID, "mailbox-1", TENANT_ID]);
  });

  it("updates a single message when thread_id is missing", async () => {
    mocks.getMessageById.mockResolvedValue(buildMessage({ thread_id: null }));
    mocks.dbQuery.mockResolvedValue({
      rows: [{ id: MESSAGE_ID }]
    });

    const { response, body } = await patchMessage({ isRead: false, isPinned: true });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      updatedIds: [MESSAGE_ID]
    });
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("is_read = $2");
    expect(sql).toContain("is_pinned = $1");
    expect(sql).toContain("AND tenant_id = $4");
    expect(values).toEqual([true, false, MESSAGE_ID, TENANT_ID]);
  });
});
