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
    preflightTicketMerge: vi.fn(),
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
  preflightTicketMerge: mocks.preflightTicketMerge,
  MergeError: mocks.MergeError
}));

import { POST } from "@/app/api/tickets/merge/preflight/route";

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

function buildPreflight(
  blockingCode: "cross_channel_not_allowed" | "too_large" | null,
  blockingReason: string | null
) {
  return {
    sourceTicketId: SOURCE_TICKET_ID,
    targetTicketId: TARGET_TICKET_ID,
    sourceChannel: "email",
    targetChannel: blockingCode === "cross_channel_not_allowed" ? "whatsapp" : "email",
    sourceTicket: {
      subject: "Source",
      requesterEmail: "source@example.com",
      status: "open",
      priority: "normal",
      assignedUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      mergedIntoTicketId: null
    },
    targetTicket: {
      subject: "Target",
      requesterEmail: "target@example.com",
      status: "open",
      priority: "normal",
      assignedUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      mergedIntoTicketId: null
    },
    moveCounts: {
      messages: 1200,
      replies: 1000,
      events: 2000,
      drafts: 400,
      sourceTags: 4,
      newTagsOnTarget: 2
    },
    allowed: blockingCode === null,
    blockingCode,
    blockingReason
  };
}

async function postPreflight(payload: Record<string, unknown>) {
  const request = new Request("http://localhost/api/tickets/merge/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await POST(request);
  const body = await response.json();
  return { response, body };
}

describe("POST /api/tickets/merge/preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildAgentUser());
    mocks.getTicketById.mockImplementation(async (ticketId: string) => {
      if (ticketId === SOURCE_TICKET_ID || ticketId === TARGET_TICKET_ID) {
        return buildTicket(ticketId);
      }
      return null;
    });
    mocks.preflightTicketMerge.mockResolvedValue(buildPreflight(null, null));
  });

  it("returns preflight with cross_channel_not_allowed blocking details", async () => {
    mocks.preflightTicketMerge.mockResolvedValue(
      buildPreflight(
        "cross_channel_not_allowed",
        "Cross-channel ticket merge is disabled. Merge customer profiles instead."
      )
    );

    const { response, body } = await postPreflight({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID
    });

    expect(response.status).toBe(200);
    expect(body.preflight).toMatchObject({
      allowed: false,
      blockingCode: "cross_channel_not_allowed",
      blockingReason: "Cross-channel ticket merge is disabled. Merge customer profiles instead."
    });
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await postPreflight({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID
    });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.preflightTicketMerge).not.toHaveBeenCalled();
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

    const { response, body } = await postPreflight({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.preflightTicketMerge).not.toHaveBeenCalled();
  });

  it("returns preflight with too_large blocking details", async () => {
    mocks.preflightTicketMerge.mockResolvedValue(
      buildPreflight("too_large", "Merge impact exceeds configured cap (6400 rows > 5000).")
    );

    const { response, body } = await postPreflight({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID
    });

    expect(response.status).toBe(200);
    expect(body.preflight).toMatchObject({
      allowed: false,
      blockingCode: "too_large",
      blockingReason: "Merge impact exceeds configured cap (6400 rows > 5000)."
    });
  });

  it("maps merge error invalid_input to HTTP 400", async () => {
    mocks.preflightTicketMerge.mockRejectedValue(
      new mocks.MergeError("invalid_input", "Source and target tickets must be different.")
    );

    const { response, body } = await postPreflight({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "invalid_input",
      error: "Source and target tickets must be different."
    });
  });

  it("returns 400 when source and target ticket IDs are identical", async () => {
    const { response, body } = await postPreflight({
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: SOURCE_TICKET_ID
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "invalid_input",
      error: "Source and target tickets must be different."
    });
    expect(mocks.getTicketById).not.toHaveBeenCalled();
    expect(mocks.preflightTicketMerge).not.toHaveBeenCalled();
  });
});
