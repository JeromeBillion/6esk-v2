import { beforeEach, describe, expect, it, vi } from "vitest";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_AGENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTicketById: vi.fn(),
  sendTicketReply: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/tickets", () => ({
  getTicketById: mocks.getTicketById
}));

vi.mock("@/server/email/replies", () => ({
  sendTicketReply: mocks.sendTicketReply
}));

import { POST } from "@/app/api/tickets/[ticketId]/replies/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer", userId = AGENT_ID) {
  return {
    id: userId,
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    role_name: roleName
  };
}

function buildTicket(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: TICKET_ID,
    assigned_user_id: AGENT_ID,
    ...overrides
  };
}

async function postReply(payload: unknown) {
  const request = new Request(`http://localhost/api/tickets/${TICKET_ID}/replies`, {
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

describe("POST /api/tickets/[ticketId]/replies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.getTicketById.mockResolvedValue(buildTicket());
    mocks.sendTicketReply.mockResolvedValue({ messageId: "msg-123" });
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await postReply({ text: "Test reply" });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
  });

  it("returns 403 for viewer role", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("viewer"));

    const { response, body } = await postReply({ text: "Test reply" });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
  });

  it("returns 403 when non-admin user is not assigned to the ticket", async () => {
    mocks.getTicketById.mockResolvedValue(buildTicket({ assigned_user_id: OTHER_AGENT_ID }));

    const { response, body } = await postReply({ text: "Need update" });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
  });

  it("returns 400 when reply payload has no body, template, or attachments", async () => {
    const { response, body } = await postReply({ subject: "Only subject" });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Reply body required" });
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
  });

  it("forwards recipient/template/attachments payload to sendTicketReply", async () => {
    const { response, body } = await postReply({
      text: "Hello on WhatsApp",
      recipient: "+27731234567",
      template: {
        name: "support_followup",
        language: "en_US",
        components: [{ type: "body", parameters: [{ type: "text", text: "A123" }] }]
      },
      attachments: [
        {
          filename: "proof.png",
          contentType: "image/png",
          size: 12345,
          contentBase64: "aGVsbG8="
        }
      ]
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "sent", id: "msg-123" });
    expect(mocks.sendTicketReply).toHaveBeenCalledTimes(1);
    expect(mocks.sendTicketReply).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: TICKET_ID,
        text: "Hello on WhatsApp",
        recipient: "+27731234567",
        actorUserId: AGENT_ID,
        origin: "human"
      })
    );
    expect(mocks.sendTicketReply.mock.calls[0]?.[0]).toMatchObject({
      template: expect.objectContaining({
        name: "support_followup",
        language: "en_US"
      }),
      attachments: expect.arrayContaining([
        expect.objectContaining({ filename: "proof.png", contentType: "image/png" })
      ])
    });
  });

  it("returns 502 with details when WhatsApp 24h window is closed", async () => {
    mocks.sendTicketReply.mockRejectedValue(
      new Error("WhatsApp 24h window closed. Template required.")
    );

    const { response, body } = await postReply({
      text: "Ping",
      recipient: "+27735550000"
    });

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "Failed to send reply",
      details: "WhatsApp 24h window closed. Template required."
    });
  });

  it("returns 502 with details when template and attachment conflict", async () => {
    mocks.sendTicketReply.mockRejectedValue(
      new Error("Templates cannot be combined with attachments.")
    );

    const { response, body } = await postReply({
      text: "Ping",
      recipient: "+27735550000",
      template: { name: "followup", language: "en_US", components: [] },
      attachments: [
        {
          filename: "image.png",
          contentType: "image/png",
          size: 5000,
          contentBase64: "aGVsbG8="
        }
      ]
    });

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "Failed to send reply",
      details: "Templates cannot be combined with attachments."
    });
  });
});
