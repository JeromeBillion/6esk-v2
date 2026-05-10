import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const TICKET_ID = "33333333-3333-4333-8333-333333333333";
const MAILBOX_ID = "44444444-4444-4444-8444-444444444444";
const ORIGINAL_ENV = { ...process.env };

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  getOrCreateMailbox: vi.fn(),
  createTicket: vi.fn(),
  inferTagsFromText: vi.fn(),
  addTagsToTicket: vi.fn(),
  recordTicketEvent: vi.fn(),
  reopenTicketIfNeeded: vi.fn(),
  attachCustomerToTicket: vi.fn(),
  resolveOrCreateCustomerForInbound: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  enqueueCallTranscriptJob: vi.fn(),
  markTranscriptJobCompleted: vi.fn(),
  enqueueCallTranscriptAiJob: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/email/mailbox", () => ({
  getOrCreateMailbox: mocks.getOrCreateMailbox
}));

vi.mock("@/server/tickets", () => ({
  addTagsToTicket: mocks.addTagsToTicket,
  createTicket: mocks.createTicket,
  inferTagsFromText: mocks.inferTagsFromText,
  recordTicketEvent: mocks.recordTicketEvent,
  reopenTicketIfNeeded: mocks.reopenTicketIfNeeded
}));

vi.mock("@/server/customers", () => ({
  attachCustomerToTicket: mocks.attachCustomerToTicket,
  resolveOrCreateCustomerForInbound: mocks.resolveOrCreateCustomerForInbound
}));

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  enqueueAgentEvent: mocks.enqueueAgentEvent,
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: vi.fn()
}));

vi.mock("@/server/calls/transcript-jobs", () => ({
  enqueueCallTranscriptJob: mocks.enqueueCallTranscriptJob,
  markTranscriptJobCompleted: mocks.markTranscriptJobCompleted
}));

vi.mock("@/server/calls/transcript-ai-jobs", () => ({
  enqueueCallTranscriptAiJob: mocks.enqueueCallTranscriptAiJob
}));

vi.mock("@/server/calls/twilio", () => ({
  buildTwilioMediaFetchConfig: vi.fn()
}));

import { createOrUpdateInboundCall, queueOutboundCall } from "@/server/calls/service";

function setupClient() {
  mocks.clientQuery.mockImplementation((sql: string) => {
    if (String(sql).includes("RETURNING event_sequence")) {
      return Promise.resolve({ rows: [{ event_sequence: 1 }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  mocks.dbConnect.mockResolvedValue({
    query: mocks.clientQuery,
    release: mocks.clientRelease
  });
}

describe("call service tenant isolation", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    process.env = { ...ORIGINAL_ENV, SUPPORT_ADDRESS: "support@example.com" };
    setupClient();
    mocks.dbQuery.mockImplementation((sql: string) => {
      if (String(sql).includes("RETURNING event_sequence")) {
        return Promise.resolve({ rows: [{ event_sequence: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mocks.getOrCreateMailbox.mockResolvedValue({
      id: MAILBOX_ID,
      tenant_id: TENANT_ID
    });
    mocks.createTicket.mockResolvedValue(TICKET_ID);
    mocks.inferTagsFromText.mockReturnValue([]);
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.reopenTicketIfNeeded.mockResolvedValue(undefined);
    mocks.attachCustomerToTicket.mockResolvedValue(undefined);
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue(null);
    mocks.buildAgentEvent.mockImplementation((payload) => payload);
    mocks.enqueueAgentEvent.mockResolvedValue(undefined);
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("scopes outbound call message and outbox writes to the ticket tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: TICKET_ID,
            tenant_id: TENANT_ID,
            mailbox_id: MAILBOX_ID,
            customer_id: null,
            requester_email: "customer@example.com",
            metadata: null,
            primary_phone: null
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await queueOutboundCall({
      ticketId: TICKET_ID,
      tenantId: TENANT_ID,
      toPhone: "+15551234567",
      reason: "Follow up",
      origin: "human",
      actorUserId: "55555555-5555-4555-8555-555555555555"
    });

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND ($2::uuid IS NULL OR t.tenant_id = $2::uuid)"),
      [TICKET_ID, TENANT_ID]
    );

    const messageInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO messages")
    );
    expect(messageInsert?.[0]).toContain("tenant_id");
    expect(messageInsert?.[1]?.[0]).toBe(TENANT_ID);

    const outboxInsert = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO call_outbox_events")
    );
    expect(outboxInsert?.[1]?.[0]).toBe(TENANT_ID);
  });

  it("stores inbound call messages under the resolved tenant", async () => {
    await createOrUpdateInboundCall({
      tenantId: TENANT_ID,
      provider: "twilio",
      providerCallId: "CA123",
      fromPhone: "+15557654321",
      toPhone: "+15551230000",
      status: "ringing"
    });

    const messageInsert = mocks.dbQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO messages")
    );
    expect(messageInsert?.[0]).toContain("tenant_id");
    expect(messageInsert?.[1]?.[0]).toBe(TENANT_ID);
    expect(mocks.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        mailboxId: MAILBOX_ID
      })
    );
  });

  it("rejects inbound calls that target a ticket outside the tenant scope", async () => {
    await expect(
      createOrUpdateInboundCall({
        tenantId: TENANT_ID,
        provider: "mock",
        providerCallId: "provider-call-1",
        fromPhone: "+15557654321",
        ticketId: TICKET_ID
      })
    ).rejects.toThrow("Ticket not found for tenant.");

    expect(mocks.dbQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO messages"))).toBe(
      false
    );
  });

  it("requires an explicit fallback tenant for unscoped production ingress", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.CALLS_TENANT_ID;

    await expect(
      createOrUpdateInboundCall({
        provider: "twilio",
        fromPhone: "+15557654321"
      })
    ).rejects.toThrow("CALLS_TENANT_ID is required");

    expect(mocks.getOrCreateMailbox).not.toHaveBeenCalled();
  });
});
