import { beforeEach, describe, expect, it, vi } from "vitest";

const MESSAGE_ID = "11111111-1111-1111-1111-111111111111";
const TICKET_ID = "22222222-2222-2222-2222-222222222222";
const MAILBOX_ID = "33333333-3333-3333-3333-333333333333";
const AGENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_AGENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getMessageById: vi.fn(),
  getTicketAssignment: vi.fn(),
  hasMailboxAccess: vi.fn(),
  dbQuery: vi.fn(),
  getObjectBuffer: vi.fn(),
  getWhatsAppWindowStatus: vi.fn(),
  recordAuditLog: vi.fn()
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

vi.mock("@/server/storage/r2", () => ({
  getObjectBuffer: mocks.getObjectBuffer
}));

vi.mock("@/server/whatsapp/window", () => ({
  getWhatsAppWindowStatus: mocks.getWhatsAppWindowStatus
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/messages/[messageId]/whatsapp-resend/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer", userId = AGENT_ID) {
  return {
    id: userId,
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    role_name: roleName
  };
}

function buildMessage(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: MESSAGE_ID,
    mailbox_id: MAILBOX_ID,
    ticket_id: TICKET_ID,
    subject: "Support follow-up",
    from_email: "support@6ex.co.za",
    to_emails: ["whatsapp:+27731234567"],
    direction: "outbound",
    channel: "whatsapp",
    origin: "human",
    is_spam: false,
    spam_reason: null,
    is_starred: false,
    is_pinned: false,
    thread_id: null,
    external_message_id: "wa-ext-123",
    conversation_id: "conv-1",
    wa_contact: "+27731234567",
    wa_status: "failed",
    wa_timestamp: null,
    provider: "meta",
    received_at: null,
    sent_at: "2026-02-15T12:00:00.000Z",
    r2_key_text: null,
    r2_key_html: null,
    ai_meta: null,
    ...overrides
  };
}

async function postResend() {
  const response = await POST(new Request(`http://localhost/api/messages/${MESSAGE_ID}/whatsapp-resend`, {
    method: "POST"
  }), {
    params: Promise.resolve({ messageId: MESSAGE_ID })
  });
  const body = await response.json();
  return { response, body };
}

describe("POST /api/messages/[messageId]/whatsapp-resend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.getMessageById.mockResolvedValue(buildMessage());
    mocks.getTicketAssignment.mockResolvedValue(AGENT_ID);
    mocks.hasMailboxAccess.mockResolvedValue(true);
    mocks.getObjectBuffer.mockResolvedValue({ buffer: Buffer.from("Recovered message body") });
    mocks.getWhatsAppWindowStatus.mockResolvedValue({ isOpen: true, minutesRemaining: 120 });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await postResend();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for viewer role", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("viewer"));

    const { response, body } = await postResend();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 403 when non-admin user is not assigned to ticket message", async () => {
    mocks.getTicketAssignment.mockResolvedValue(OTHER_AGENT_ID);

    const { response, body } = await postResend();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 403 when mailbox access is missing for non-ticket message", async () => {
    mocks.getMessageById.mockResolvedValue(
      buildMessage({ ticket_id: null, mailbox_id: MAILBOX_ID })
    );
    mocks.hasMailboxAccess.mockResolvedValue(false);

    const { response, body } = await postResend();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 409 when latest WhatsApp status is not failed", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ status: "delivered" }],
      rowCount: 1
    });

    const { response, body } = await postResend();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Only failed messages can be resent" });
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when recipient cannot be reconstructed", async () => {
    mocks.getMessageById.mockResolvedValue(
      buildMessage({
        ticket_id: null,
        to_emails: [],
        wa_contact: null,
        r2_key_text: null
      })
    );
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ status: "failed" }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ payload: {} }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

    const { response, body } = await postResend();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Missing WhatsApp recipient" });
  });

  it("returns 409 when payload cannot be reconstructed", async () => {
    mocks.getMessageById.mockResolvedValue(
      buildMessage({
        ticket_id: null,
        r2_key_text: null
      })
    );
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ status: "failed" }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ payload: { to: "+27731234567" } }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

    const { response, body } = await postResend();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Unable to reconstruct message payload" });
  });

  it("returns 409 when 24h window is closed and no template is present", async () => {
    mocks.getWhatsAppWindowStatus.mockResolvedValue({ isOpen: false, minutesRemaining: 0 });
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ status: "failed" }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [{ payload: { to: "+27731234567", text: "Need an update" } }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

    const { response, body } = await postResend();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "WhatsApp 24h window closed. Template required." });
  });

  it("queues resend when failed status and template payload are available", async () => {
    mocks.getWhatsAppWindowStatus.mockResolvedValue({ isOpen: false, minutesRemaining: 0 });
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ status: "failed" }],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            payload: {
              to: "+27731234567",
              template: { name: "support_followup", language: "en_US" }
            }
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const { response, body } = await postResend();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "queued" });
    expect(mocks.dbQuery).toHaveBeenCalledTimes(6);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("INSERT INTO whatsapp_events"),
      expect.any(Array)
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("INSERT INTO whatsapp_status_events"),
      expect.any(Array)
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: AGENT_ID,
        action: "whatsapp_resend_queued",
        entityType: "message",
        entityId: MESSAGE_ID
      })
    );
  });
});
