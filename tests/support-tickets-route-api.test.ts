import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canManageTickets: vi.fn(),
  getOrCreateMailbox: vi.fn(),
  inferTagsFromText: vi.fn(),
  createTicket: vi.fn(),
  recordTicketEvent: vi.fn(),
  addTagsToTicket: vi.fn(),
  resolveOrCreateCustomerForInbound: vi.fn(),
  normalizeCallPhone: vi.fn(),
  queueOutboundCall: vi.fn(),
  deliverPendingCallEvents: vi.fn(),
  evaluateVoiceCallPolicy: vi.fn(),
  getHumanVoicePolicyFromEnv: vi.fn(),
  getLatestVoiceConsentState: vi.fn(),
  syncVoiceConsentFromMetadata: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  sendTicketReply: vi.fn(),
  putObject: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  canManageTickets: mocks.canManageTickets
}));

vi.mock("@/server/email/mailbox", () => ({
  getOrCreateMailbox: mocks.getOrCreateMailbox
}));

vi.mock("@/server/tickets", () => ({
  addTagsToTicket: mocks.addTagsToTicket,
  createTicket: mocks.createTicket,
  inferTagsFromText: mocks.inferTagsFromText,
  recordTicketEvent: mocks.recordTicketEvent
}));

vi.mock("@/server/customers", () => ({
  resolveOrCreateCustomerForInbound: mocks.resolveOrCreateCustomerForInbound
}));

vi.mock("@/server/calls/service", () => ({
  normalizeCallPhone: mocks.normalizeCallPhone,
  queueOutboundCall: mocks.queueOutboundCall
}));

vi.mock("@/server/calls/outbox", () => ({
  deliverPendingCallEvents: mocks.deliverPendingCallEvents
}));

vi.mock("@/server/calls/policy", () => ({
  evaluateVoiceCallPolicy: mocks.evaluateVoiceCallPolicy,
  getHumanVoicePolicyFromEnv: mocks.getHumanVoicePolicyFromEnv
}));

vi.mock("@/server/calls/consent", () => ({
  getLatestVoiceConsentState: mocks.getLatestVoiceConsentState,
  syncVoiceConsentFromMetadata: mocks.syncVoiceConsentFromMetadata
}));

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  enqueueAgentEvent: mocks.enqueueAgentEvent,
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/email/replies", () => ({
  sendTicketReply: mocks.sendTicketReply
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { POST } from "@/app/api/support/tickets/route";

const ORIGINAL_ENV = { ...process.env };

describe("POST /api/support/tickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      SUPPORT_ADDRESS: "support@6ex.co.za",
      INBOUND_SHARED_SECRET: "support-secret"
    };

    mocks.getSessionUser.mockResolvedValue(null);
    mocks.canManageTickets.mockReturnValue(true);
    mocks.getOrCreateMailbox.mockResolvedValue({ id: "mailbox-1" });
    mocks.inferTagsFromText.mockReturnValue(["general"]);
    mocks.createTicket.mockResolvedValue("ticket-1");
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.addTagsToTicket.mockResolvedValue(undefined);
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue({
      customerId: "customer-1"
    });
    mocks.normalizeCallPhone.mockReturnValue("+15551234567");
    mocks.queueOutboundCall.mockResolvedValue({
      status: "queued",
      callSessionId: "call-1",
      messageId: "message-1",
      toPhone: "+15551234567",
      idempotent: false
    });
    mocks.deliverPendingCallEvents.mockResolvedValue(undefined);
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({ allowed: true });
    mocks.getHumanVoicePolicyFromEnv.mockReturnValue({ voice: {} });
    mocks.getLatestVoiceConsentState.mockResolvedValue({
      state: "unknown",
      callbackPhone: null,
      termsVersion: null,
      source: null,
      updatedAt: null,
      identityType: null,
      identityValue: null,
      customerId: "customer-1"
    });
    mocks.syncVoiceConsentFromMetadata.mockResolvedValue(false);
    mocks.buildAgentEvent.mockReturnValue({ id: "evt-1" });
    mocks.enqueueAgentEvent.mockResolvedValue(undefined);
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
    mocks.sendTicketReply.mockResolvedValue({ messageId: "message-1" });
    mocks.putObject.mockResolvedValue("messages/message-1/body.txt");
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 401 when request is not authenticated and secret is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/support/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: "user@example.com",
          subject: "Help",
          description: "Need support"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid payload shape", async () => {
    const response = await POST(
      new Request("http://localhost/api/support/tickets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "support-secret"
        },
        body: JSON.stringify({
          from: "bad-email",
          subject: "",
          description: null
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid payload");
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });

  it("creates inbound support ticket for trusted external caller", async () => {
    const response = await POST(
      new Request("http://localhost/api/support/tickets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "support-secret"
        },
        body: JSON.stringify({
          from: "user@example.com",
          subject: "Withdrawal pending",
          description: "Please check my payout.",
          metadata: {
            appUserEmail: "user@example.com",
            isAuthenticated: true,
            appUserId: "pm-user-1"
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "created",
      ticketId: "ticket-1"
    });
    expect(mocks.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxId: "mailbox-1",
        requesterEmail: "user@example.com"
      })
    );
    expect(mocks.dbQuery).toHaveBeenCalled();
    expect(mocks.enqueueAgentEvent).toHaveBeenCalled();
  });

  it("blocks call-mode request when policy denies due revoked consent", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "agent-1",
      email: "agent@6ex.co.za",
      display_name: "Agent",
      role_id: "role-1",
      role_name: "agent"
    });
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({
      allowed: false,
      code: "consent_required",
      detail: "Voice consent has been revoked. Ask the customer to opt in again before calling."
    });
    mocks.getLatestVoiceConsentState.mockResolvedValue({
      state: "revoked",
      callbackPhone: "+15551234567",
      termsVersion: "v2.3",
      source: "help_center_self_service",
      updatedAt: "2026-02-19T10:00:00.000Z",
      identityType: "phone",
      identityValue: "+15551234567",
      customerId: "customer-1"
    });

    const response = await POST(
      new Request("http://localhost/api/support/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactMode: "call",
          toPhone: "+15551234567",
          subject: "Call customer",
          description: "Follow up by phone"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      status: "blocked",
      errorCode: "consent_required"
    });
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });
});
