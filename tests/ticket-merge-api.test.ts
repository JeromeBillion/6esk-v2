import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MergeError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  return {
    getSessionUser: vi.fn(),
    getTicketById: vi.fn(),
    mergeTickets: vi.fn(),
    MergeError
  };
});

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/tickets", () => ({
  getTicketById: mocks.getTicketById
}));

vi.mock("@/server/merges", () => ({
  mergeTickets: mocks.mergeTickets,
  MergeError: mocks.MergeError
}));

import { POST } from "@/app/api/tickets/merge/route";

const SOURCE_TICKET_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_TICKET_ID = "22222222-2222-2222-2222-222222222222";
const ACK_TEXT = "I understand this merge is irreversible";

function buildAgentUser() {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "agent@6ex.co.za",
    display_name: "Support Agent",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "agent"
  };
}

function buildTicket(id: string) {
  return {
    id,
    assigned_user_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
  };
}

async function postMerge(payload: Record<string, unknown>) {
  const request = new Request("http://localhost/api/tickets/merge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await POST(request);
  const body = await response.json();
  return { response, body };
}

describe("POST /api/tickets/merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildAgentUser());
    mocks.getTicketById.mockImplementation(async (ticketId: string) => {
      if (ticketId === SOURCE_TICKET_ID || ticketId === TARGET_TICKET_ID) {
        return buildTicket(ticketId);
      }
      return null;
    });
    mocks.mergeTickets.mockResolvedValue({ sourceTicketId: SOURCE_TICKET_ID, targetTicketId: TARGET_TICKET_ID });
  });

  it("returns 409 with cross_channel_not_allowed code when merge execution is blocked by channel", async () => {
    mocks.mergeTickets.mockRejectedValue(
      new mocks.MergeError(
        "cross_channel_not_allowed",
        "Cross-channel ticket merge is disabled. Link the tickets as one case instead."
      )
    );

    const { response, body } = await postMerge({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "cross_channel_not_allowed",
      error: "Cross-channel ticket merge is disabled. Link the tickets as one case instead."
    });
    expect(mocks.mergeTickets).toHaveBeenCalledWith({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      reason: null
    });
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const { response, body } = await postMerge({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.mergeTickets).not.toHaveBeenCalled();
  });

  it("returns 403 when non-admin user is not assigned to both tickets", async () => {
    mocks.getTicketById.mockImplementation(async (ticketId: string) => {
      if (ticketId === SOURCE_TICKET_ID) return buildTicket(ticketId);
      if (ticketId === TARGET_TICKET_ID) {
        return {
          id: ticketId,
          assigned_user_id: "cccccccc-cccc-cccc-cccc-cccccccccccc"
        };
      }
      return null;
    });

    const { response, body } = await postMerge({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.mergeTickets).not.toHaveBeenCalled();
  });

  it("returns 409 with too_large code when merge execution exceeds configured cap", async () => {
    mocks.mergeTickets.mockRejectedValue(
      new mocks.MergeError("too_large", "Merge impact exceeds configured cap (6400 rows > 5000).")
    );

    const { response, body } = await postMerge({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      reason: "Duplicate escalation thread",
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "too_large",
      error: "Merge impact exceeds configured cap (6400 rows > 5000)."
    });
    expect(mocks.mergeTickets).toHaveBeenCalledWith({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      reason: "Duplicate escalation thread"
    });
  });

  it("returns success payload when mergeTickets resolves", async () => {
    const { response, body } = await postMerge({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      reason: "Duplicate issue",
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "merged",
      result: {
        sourceTicketId: SOURCE_TICKET_ID,
        targetTicketId: TARGET_TICKET_ID
      }
    });
  });

  it("returns 400 when irreversible acknowledgement is missing or invalid", async () => {
    const { response, body } = await postMerge({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      acknowledgement: "wrong text"
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid payload" });
    expect(mocks.mergeTickets).not.toHaveBeenCalled();
  });

  it("returns 400 when source and target ticket IDs are identical", async () => {
    const { response, body } = await postMerge({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: SOURCE_TICKET_ID,
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "invalid_input",
      error: "Source and target tickets must be different."
    });
    expect(mocks.getTicketById).not.toHaveBeenCalled();
    expect(mocks.mergeTickets).not.toHaveBeenCalled();
  });
});
