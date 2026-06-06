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
    linkTickets: vi.fn(),
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
  linkTickets: mocks.linkTickets,
  MergeError: mocks.MergeError
}));

import { POST } from "@/app/api/tickets/link/route";

const SOURCE_TICKET_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_TICKET_ID = "22222222-2222-2222-2222-222222222222";

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

async function postLink(payload: Record<string, unknown>) {
  const request = new Request("http://localhost/api/tickets/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await POST(request);
  const body = await response.json();
  return { response, body };
}

describe("POST /api/tickets/link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildAgentUser());
    mocks.getTicketById.mockImplementation(async (ticketId: string) => {
      if (ticketId === SOURCE_TICKET_ID || ticketId === TARGET_TICKET_ID) {
        return buildTicket(ticketId);
      }
      return null;
    });
    mocks.linkTickets.mockResolvedValue({
      id: "link-1",
      relationshipType: "linked_case",
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID
    });
  });

  it("returns linked status when linkTickets resolves", async () => {
    const { response, body } = await postLink({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      reason: "Same issue moved to WhatsApp"
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "linked",
      result: {
        sourceTicketId: SOURCE_TICKET_ID,
        targetTicketId: TARGET_TICKET_ID
      }
    });
    expect(mocks.linkTickets).toHaveBeenCalledWith({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      reason: "Same issue moved to WhatsApp"
    });
  });

  it("maps already_linked to HTTP 409", async () => {
    mocks.linkTickets.mockRejectedValue(
      new mocks.MergeError("already_linked", "Source and target tickets are already linked.")
    );

    const { response, body } = await postLink({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "already_linked",
      error: "Source and target tickets are already linked."
    });
  });
});
