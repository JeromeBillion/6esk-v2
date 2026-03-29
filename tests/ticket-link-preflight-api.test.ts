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
    preflightTicketLink: vi.fn(),
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
  preflightTicketLink: mocks.preflightTicketLink,
  MergeError: mocks.MergeError
}));

import { POST } from "@/app/api/tickets/link/preflight/route";

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

async function postPreflight(payload: Record<string, unknown>) {
  const request = new Request("http://localhost/api/tickets/link/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await POST(request);
  const body = await response.json();
  return { response, body };
}

describe("POST /api/tickets/link/preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildAgentUser());
    mocks.getTicketById.mockImplementation(async (ticketId: string) => {
      if (ticketId === SOURCE_TICKET_ID || ticketId === TARGET_TICKET_ID) {
        return buildTicket(ticketId);
      }
      return null;
    });
    mocks.preflightTicketLink.mockResolvedValue({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      sourceChannel: "email",
      targetChannel: "whatsapp",
      sourceTicket: {
        customerId: null,
        subject: "Source",
        requesterEmail: "source@example.com",
        status: "open",
        priority: "normal",
        assignedUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        mergedIntoTicketId: null
      },
      targetTicket: {
        customerId: null,
        subject: "Target",
        requesterEmail: "whatsapp:+27123456789",
        status: "open",
        priority: "high",
        assignedUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        mergedIntoTicketId: null
      },
      sourceCustomerId: null,
      targetCustomerId: null,
      recommendedAction: "linked_case",
      allowed: true,
      blockingCode: null,
      blockingReason: null
    });
  });

  it("returns linked-case preflight payload", async () => {
    const { response, body } = await postPreflight({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID
    });

    expect(response.status).toBe(200);
    expect(body.preflight).toMatchObject({
      recommendedAction: "linked_case",
      allowed: true
    });
  });

  it("maps already_linked to HTTP 409", async () => {
    mocks.preflightTicketLink.mockRejectedValue(
      new mocks.MergeError("already_linked", "Source and target tickets are already linked.")
    );

    const { response, body } = await postPreflight({
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
