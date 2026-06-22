import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";
const ORIGINAL_SUPPORT_ADDRESS = process.env.SUPPORT_ADDRESS;
const ORIGINAL_RESEND_API_KEY = process.env.RESEND_API_KEY;

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getTicketById: vi.fn(),
  recordTicketEvent: vi.fn(),
  getCustomerById: vi.fn(),
  putObject: vi.fn(),
  queueWhatsAppSend: vi.fn(),
  getWhatsAppWindowStatus: vi.fn(),
  getActiveConnectionForMailbox: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/tickets", () => ({
  getTicketById: mocks.getTicketById,
  recordTicketEvent: mocks.recordTicketEvent
}));

vi.mock("@/server/customers", () => ({
  getCustomerById: mocks.getCustomerById
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject
}));

vi.mock("@/server/whatsapp/send", () => ({
  queueWhatsAppSend: mocks.queueWhatsAppSend
}));

vi.mock("@/server/whatsapp/window", () => ({
  getWhatsAppWindowStatus: mocks.getWhatsAppWindowStatus
}));

vi.mock("@/server/oauth/connections", () => ({
  getActiveConnectionForMailbox: mocks.getActiveConnectionForMailbox,
  getConnectionTokens: vi.fn()
}));

import { sendTicketReply } from "@/server/email/replies";

describe("sendTicketReply tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPPORT_ADDRESS = "support@example.com";
    process.env.RESEND_API_KEY = "resend-test-key";
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.getCustomerById.mockResolvedValue(null);
    mocks.putObject.mockResolvedValue("messages/message-1/body.txt");
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.getActiveConnectionForMailbox.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: "resend-message-1" })
      })
    );
  });

  afterEach(() => {
    if (ORIGINAL_SUPPORT_ADDRESS === undefined) {
      delete process.env.SUPPORT_ADDRESS;
    } else {
      process.env.SUPPORT_ADDRESS = ORIGINAL_SUPPORT_ADDRESS;
    }
    if (ORIGINAL_RESEND_API_KEY === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = ORIGINAL_RESEND_API_KEY;
    }
    vi.unstubAllGlobals();
  });

  it("rejects missing tenant scope before ticket lookup", async () => {
    await expect(
      sendTicketReply({
        tenantId: "",
        ticketId: "ticket-1",
        text: "Reply"
      })
    ).rejects.toThrow("Send ticket reply requires tenantId");

    expect(mocks.getTicketById).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("looks up tickets only within the supplied tenant", async () => {
    mocks.getTicketById.mockResolvedValue(null);

    await expect(
      sendTicketReply({
        tenantId: TENANT_ID,
        ticketId: "ticket-1",
        text: "Reply"
      })
    ).rejects.toThrow("Ticket not found");

    expect(mocks.getTicketById).toHaveBeenCalledWith("ticket-1", TENANT_ID);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("keeps follow-up message updates tenant-scoped", async () => {
    mocks.getTicketById.mockResolvedValue({
      id: "ticket-1",
      tenant_id: TENANT_ID,
      mailbox_id: "mailbox-1",
      requester_email: "customer@example.com",
      customer_id: null,
      subject: "Need help",
      status: "open",
      metadata: null
    });

    await expect(
      sendTicketReply({
        tenantId: TENANT_ID,
        ticketId: "ticket-1",
        text: "Reply"
      })
    ).resolves.toMatchObject({ messageId: expect.any(String) });

    const [updateSql, updateValues] = mocks.dbQuery.mock.calls[1] ?? [];
    expect(updateSql).toContain("WHERE id = $4 AND tenant_id = $5");
    expect(updateValues[4]).toBe(TENANT_ID);
  });

  it("sends and persists cc and bcc recipients on email replies", async () => {
    mocks.getTicketById.mockResolvedValue({
      id: "ticket-1",
      tenant_id: TENANT_ID,
      mailbox_id: "mailbox-1",
      requester_email: "customer@example.com",
      customer_id: null,
      subject: "Need help",
      status: "open",
      metadata: null
    });

    await expect(
      sendTicketReply({
        tenantId: TENANT_ID,
        ticketId: "ticket-1",
        text: "Reply",
        cc: "team@example.com, Lead <lead@example.com>",
        bcc: ["audit@example.com"]
      })
    ).resolves.toMatchObject({ messageId: expect.any(String) });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const resendBody = JSON.parse(String(fetchCall?.[1]?.body));
    expect(resendBody).toMatchObject({
      to: ["customer@example.com"],
      cc: ["team@example.com", "lead@example.com"],
      bcc: ["audit@example.com"]
    });

    const insertCall = mocks.dbQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO messages")
    );
    expect(String(insertCall?.[0])).toContain("cc_emails");
    expect(String(insertCall?.[0])).toContain("bcc_emails");
    expect(insertCall?.[1][7]).toEqual(["customer@example.com"]);
    expect(insertCall?.[1][8]).toEqual(["team@example.com", "lead@example.com"]);
    expect(insertCall?.[1][9]).toEqual(["audit@example.com"]);
  });

  it("rejects invalid cc and bcc recipients before provider delivery", async () => {
    mocks.getTicketById.mockResolvedValue({
      id: "ticket-1",
      tenant_id: TENANT_ID,
      mailbox_id: "mailbox-1",
      requester_email: "customer@example.com",
      customer_id: null,
      subject: "Need help",
      status: "open",
      metadata: null
    });

    await expect(
      sendTicketReply({
        tenantId: TENANT_ID,
        ticketId: "ticket-1",
        text: "Reply",
        cc: "bad-cc",
        bcc: ["audit@example.com", "bad-bcc"]
      })
    ).rejects.toThrow("Invalid Cc recipient: bad-cc");

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects invalid email recipient overrides before provider delivery", async () => {
    mocks.getTicketById.mockResolvedValue({
      id: "ticket-1",
      tenant_id: TENANT_ID,
      mailbox_id: "mailbox-1",
      requester_email: "customer@example.com",
      customer_id: null,
      subject: "Need help",
      status: "open",
      metadata: null
    });

    await expect(
      sendTicketReply({
        tenantId: TENANT_ID,
        ticketId: "ticket-1",
        text: "Reply",
        recipient: "not-an-email"
      })
    ).rejects.toThrow("Invalid To recipient: not-an-email");

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("keeps WhatsApp phone recipient overrides out of email validation", async () => {
    mocks.getTicketById.mockResolvedValue({
      id: "ticket-1",
      tenant_id: TENANT_ID,
      mailbox_id: "mailbox-1",
      requester_email: "whatsapp:+27731230000",
      customer_id: null,
      subject: "Need help",
      status: "open",
      metadata: { channel: "whatsapp" }
    });
    mocks.getWhatsAppWindowStatus.mockResolvedValue({ isOpen: true });
    mocks.queueWhatsAppSend.mockResolvedValue({ messageId: "wa-message-1" });

    await expect(
      sendTicketReply({
        tenantId: TENANT_ID,
        ticketId: "ticket-1",
        text: "Reply",
        recipient: "+27731234567"
      })
    ).resolves.toEqual({ messageId: "wa-message-1" });

    expect(mocks.queueWhatsAppSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+27731234567"
      })
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
