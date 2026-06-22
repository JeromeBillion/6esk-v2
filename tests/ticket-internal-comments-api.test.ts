import { beforeEach, describe, expect, it, vi } from "vitest";

const TICKET_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "99999999-9999-4999-8999-999999999999";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTicketById: vi.fn(),
  createTicketInternalComment: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/tickets", () => ({
  getTicketById: mocks.getTicketById,
  createTicketInternalComment: mocks.createTicketInternalComment
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/tickets/[ticketId]/internal-comments/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer", userId = AGENT_ID, tenantId: string | null = TENANT_ID) {
  return {
    id: userId,
    email: `${roleName}@6esk.test`,
    display_name: roleName,
    role_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    role_name: roleName,
    tenant_id: tenantId
  };
}

async function postInternalComment(payload: unknown) {
  const request = new Request(`http://localhost/api/tickets/${TICKET_ID}/internal-comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await POST(request, {
    params: Promise.resolve({ ticketId: TICKET_ID })
  });
  const body = await response.json();
  return { response, body };
}

describe("POST /api/tickets/[ticketId]/internal-comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.getTicketById.mockResolvedValue({ id: TICKET_ID, assigned_user_id: AGENT_ID });
    mocks.createTicketInternalComment.mockResolvedValue({
      id: "comment-1",
      event_type: "internal_comment",
      actor_user_id: AGENT_ID,
      data: {
        body: "Escalation risk noted.",
        visibility: "internal",
        origin: "human"
      },
      created_at: "2026-06-21T10:00:00.000Z"
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("stores an assigned agent internal comment without outbound provider calls", async () => {
    const { response, body } = await postInternalComment({ body: " Escalation risk noted. " });

    expect(response.status).toBe(200);
    expect(body.comment).toMatchObject({ id: "comment-1", event_type: "internal_comment" });
    expect(mocks.createTicketInternalComment).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      ticketId: TICKET_ID,
      body: "Escalation risk noted.",
      actorUserId: AGENT_ID,
      origin: "human",
      metadata: null
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: AGENT_ID,
        action: "internal_comment_created",
        entityType: "ticket",
        entityId: TICKET_ID
      })
    );
  });

  it("blocks unassigned non-admin users", async () => {
    mocks.getTicketById.mockResolvedValue({ id: TICKET_ID, assigned_user_id: OTHER_AGENT_ID });

    const { response, body } = await postInternalComment({ body: "Private note" });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.createTicketInternalComment).not.toHaveBeenCalled();
  });

  it("rejects empty comments", async () => {
    const { response, body } = await postInternalComment({ body: "   " });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid payload" });
    expect(mocks.createTicketInternalComment).not.toHaveBeenCalled();
  });
});
