import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const MAILBOX_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  resolveInboundMailbox: vi.fn(),
  getOrCreateMailbox: vi.fn(),
  evaluateSpam: vi.fn(),
  lookupPredictionProfile: vi.fn(),
  buildProfileMetadataPatch: vi.fn(),
  resolveOrCreateCustomerForInbound: vi.fn(),
  upsertExternalUserLink: vi.fn(),
  inferTagsFromText: vi.fn(),
  resolveTicketIdForInbound: vi.fn(),
  putObject: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  decryptSecret: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/email/mailbox", () => ({
  resolveInboundMailbox: mocks.resolveInboundMailbox,
  getOrCreateMailbox: mocks.getOrCreateMailbox
}));

vi.mock("@/server/email/spam", () => ({
  evaluateSpam: mocks.evaluateSpam
}));

vi.mock("@/server/integrations/prediction-profile", () => ({
  lookupPredictionProfile: mocks.lookupPredictionProfile,
  buildProfileMetadataPatch: mocks.buildProfileMetadataPatch
}));

vi.mock("@/server/customers", () => ({
  resolveOrCreateCustomerForInbound: mocks.resolveOrCreateCustomerForInbound
}));

vi.mock("@/server/integrations/external-user-links", () => ({
  upsertExternalUserLink: mocks.upsertExternalUserLink
}));

vi.mock("@/server/tickets", () => ({
  inferTagsFromText: mocks.inferTagsFromText,
  resolveTicketIdForInbound: mocks.resolveTicketIdForInbound
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject
}));

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  enqueueAgentEvent: mocks.enqueueAgentEvent,
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/agents/secret", () => ({
  decryptSecret: mocks.decryptSecret
}));

function setupTransaction() {
  mocks.clientQuery.mockImplementation((sql: string) => {
    if (sql.includes("INSERT INTO tickets")) {
      return Promise.resolve({ rows: [{ id: TICKET_ID }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  mocks.dbConnect.mockResolvedValue({
    query: mocks.clientQuery,
    release: mocks.clientRelease
  });
}

describe("inbound tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPPORT_ADDRESS = "support@example.com";
    setupTransaction();
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.resolveInboundMailbox.mockResolvedValue({
      id: MAILBOX_ID,
      tenant_id: TENANT_ID,
      type: "platform",
      address: "support@example.com",
      owner_user_id: null
    });
    mocks.getOrCreateMailbox.mockResolvedValue({
      id: MAILBOX_ID,
      tenant_id: TENANT_ID,
      type: "platform",
      address: "support@example.com",
      owner_user_id: null
    });
    mocks.evaluateSpam.mockResolvedValue({ isSpam: false, reason: null });
    mocks.lookupPredictionProfile.mockResolvedValue({ status: "missed" });
    mocks.buildProfileMetadataPatch.mockReturnValue({});
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue({
      customerId: CUSTOMER_ID,
      kind: "unregistered"
    });
    mocks.inferTagsFromText.mockReturnValue([]);
    mocks.resolveTicketIdForInbound.mockResolvedValue(null);
    mocks.putObject.mockResolvedValue("messages/body.txt");
    mocks.buildAgentEvent.mockImplementation((payload) => payload);
    mocks.enqueueAgentEvent.mockResolvedValue("event-1");
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
  });

  it("stores inbound email rows under the resolved mailbox tenant", async () => {
    const { storeInboundEmail } = await import("@/server/email/inbound-store");

    await storeInboundEmail({
      from: "customer@example.com",
      to: "support@example.com",
      subject: "Need help",
      text: "Please help",
      messageId: "<message@example.com>",
      references: ["<thread@example.com>"],
      attachments: [
        {
          filename: "statement.txt",
          contentType: "text/plain",
          contentBase64: Buffer.from("hello").toString("base64")
        }
      ]
    });

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND tenant_id = $3"),
      ["<message@example.com>", MAILBOX_ID, TENANT_ID]
    );
    expect(mocks.resolveOrCreateCustomerForInbound).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, inboundEmail: "customer@example.com" })
    );
    expect(mocks.resolveTicketIdForInbound).toHaveBeenCalledWith(
      expect.any(Array),
      TENANT_ID
    );

    const ticketInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO tickets")
    );
    expect(ticketInsert?.[0]).toContain("tenant_id");
    expect(ticketInsert?.[1]?.[0]).toBe(TENANT_ID);

    const messageInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO messages")
    );
    expect(messageInsert?.[0]).toContain("tenant_id");
    expect(messageInsert?.[1]?.[0]).toBe(TENANT_ID);

    const attachmentInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO attachments")
    );
    expect(attachmentInsert?.[0]).toContain("tenant_id");
    expect(attachmentInsert?.[1]?.[0]).toBe(TENANT_ID);

    const updateMessage = mocks.dbQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE messages")
    );
    expect(updateMessage?.[0]).toContain("AND tenant_id = $6");
    expect(updateMessage?.[1]?.[5]).toBe(TENANT_ID);
  });

  it("stores inbound WhatsApp rows under the resolved account tenant", async () => {
    const { storeInboundWhatsApp } = await import("@/server/whatsapp/inbound-store");

    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "whatsapp-account-1",
            tenant_id: TENANT_ID,
            provider: "meta",
            phone_number: "+15551230000",
            waba_id: "waba-1",
            access_token: null
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await storeInboundWhatsApp({
      provider: "meta",
      messageId: "wamid.1",
      conversationId: "+15551234567",
      from: "+15551234567",
      to: "+15551230000",
      text: "Need help",
      timestamp: "1700000000",
      contactName: "Customer",
      attachments: [
        {
          filename: "photo.txt",
          contentBase64: Buffer.from("image").toString("base64"),
          mimeType: "text/plain"
        }
      ]
    });

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND tenant_id = $2"),
      ["wamid.1", TENANT_ID]
    );
    expect(mocks.resolveOrCreateCustomerForInbound).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, inboundPhone: "+15551234567" })
    );
    expect(mocks.getOrCreateMailbox).toHaveBeenCalledWith(
      "support@example.com",
      "support@example.com",
      TENANT_ID
    );

    const ticketInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO tickets")
    );
    expect(ticketInsert?.[0]).toContain("tenant_id");
    expect(ticketInsert?.[1]?.[0]).toBe(TENANT_ID);

    const messageInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO messages")
    );
    expect(messageInsert?.[0]).toContain("tenant_id");
    expect(messageInsert?.[1]?.[0]).toBe(TENANT_ID);

    const statusInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO whatsapp_status_events")
    );
    expect(statusInsert?.[0]).toContain("tenant_id");
    expect(statusInsert?.[1]?.[0]).toBe(TENANT_ID);

    const attachmentInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO attachments")
    );
    expect(attachmentInsert?.[0]).toContain("tenant_id");
    expect(attachmentInsert?.[1]?.[0]).toBe(TENANT_ID);

    const updateMessage = mocks.dbQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE messages")
    );
    expect(updateMessage?.[0]).toContain("AND tenant_id = $4");
    expect(updateMessage?.[1]?.[3]).toBe(TENANT_ID);
  });
});
