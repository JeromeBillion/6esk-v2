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
  queueWhatsAppSend: vi.fn(),
  deliverPendingCallEvents: vi.fn(),
  getLatestVoiceConsentState: vi.fn(),
  syncVoiceConsentFromMetadata: vi.fn(),
  evaluateVoiceCallPolicy: vi.fn(),
  getHumanVoicePolicyFromEnv: vi.fn(),
  isWorkspaceModuleEnabled: vi.fn(),
  recordModuleUsageEvent: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn()
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

vi.mock("@/server/whatsapp/send", () => ({
  queueWhatsAppSend: mocks.queueWhatsAppSend
}));

vi.mock("@/server/calls/outbox", () => ({
  deliverPendingCallEvents: mocks.deliverPendingCallEvents
}));

vi.mock("@/server/calls/consent", () => ({
  getLatestVoiceConsentState: mocks.getLatestVoiceConsentState,
  syncVoiceConsentFromMetadata: mocks.syncVoiceConsentFromMetadata
}));

vi.mock("@/server/calls/policy", () => ({
  evaluateVoiceCallPolicy: mocks.evaluateVoiceCallPolicy,
  getHumanVoicePolicyFromEnv: mocks.getHumanVoicePolicyFromEnv
}));

vi.mock("@/server/workspace-modules", () => ({
  DEFAULT_WORKSPACE_KEY: "primary",
  isWorkspaceModuleEnabled: mocks.isWorkspaceModuleEnabled
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: mocks.recordModuleUsageEvent
}));

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  enqueueAgentEvent: mocks.enqueueAgentEvent,
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

import { POST } from "@/app/api/tickets/create/route";

const ORIGINAL_ENV = { ...process.env };

describe("POST /api/tickets/create call-mode voice policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, SUPPORT_ADDRESS: "support@6ex.co.za" };
    mocks.getSessionUser.mockResolvedValue({
      id: "agent-1",
      email: "agent@6ex.co.za",
      display_name: "Agent",
      role_id: "role-1",
      role_name: "agent"
    });
    mocks.canManageTickets.mockReturnValue(true);
    mocks.getOrCreateMailbox.mockResolvedValue({ id: "mailbox-1" });
    mocks.inferTagsFromText.mockReturnValue([]);
    mocks.normalizeCallPhone.mockReturnValue("+15551234567");
    mocks.getHumanVoicePolicyFromEnv.mockReturnValue({ voice: {} });
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({ allowed: true });
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
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
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue({
      customerId: "customer-1"
    });
    mocks.createTicket.mockResolvedValue("ticket-1");
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.addTagsToTicket.mockResolvedValue(undefined);
    mocks.queueOutboundCall.mockResolvedValue({
      status: "queued",
      callSessionId: "call-1",
      messageId: "message-1"
    });
    mocks.queueWhatsAppSend.mockResolvedValue({
      status: "queued",
      messageId: "wa-msg-1"
    });
    mocks.buildAgentEvent.mockReturnValue({ id: "evt-1" });
    mocks.enqueueAgentEvent.mockResolvedValue(undefined);
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
    mocks.deliverPendingCallEvents.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns blocked when call-mode policy denies the request", async () => {
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({
      allowed: false,
      code: "consent_required",
      detail: "Voice consent is required before placing this call."
    });

    const response = await POST(
      new Request("http://localhost/api/tickets/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactMode: "call",
          toPhone: "+15551234567",
          subject: "Call customer",
          description: "Follow up via phone"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      status: "blocked",
      errorCode: "consent_required"
    });
    expect(mocks.createTicket).not.toHaveBeenCalled();
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("evaluates policy before queueing and creates call-mode ticket when allowed", async () => {
    const response = await POST(
      new Request("http://localhost/api/tickets/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactMode: "call",
          toPhone: "+15551234567",
          subject: "Call customer",
          description: "Follow up via phone",
          metadata: {
            voiceConsent: true
          }
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "created",
      ticketId: "ticket-1",
      callSessionId: "call-1",
      channel: "voice"
    });
    expect(mocks.evaluateVoiceCallPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "human",
        consentState: expect.objectContaining({
          state: "unknown"
        }),
        selectedCandidateId: null,
        actorUserId: "agent-1",
        ticketMetadata: expect.objectContaining({
          toPhone: "+15551234567",
          voiceConsent: true
        })
      })
    );
    expect(mocks.queueOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        toPhone: "+15551234567",
        origin: "human",
        actorUserId: "agent-1"
      })
    );
  });

  it("defaults queued call reason to subject when call reason is omitted", async () => {
    const response = await POST(
      new Request("http://localhost/api/tickets/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactMode: "call",
          toPhone: "+15551234567",
          subject: "Call customer"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "created",
      ticketId: "ticket-1",
      channel: "voice"
    });
    expect(mocks.queueOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Call customer"
      })
    );
  });

  it("creates outbound WhatsApp ticket when WhatsApp contact mode is selected", async () => {
    const response = await POST(
      new Request("http://localhost/api/tickets/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactMode: "whatsapp",
          toPhone: "+15551234567",
          subject: "Invoice follow-up",
          description: "Can I send the corrected invoice here?"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "created",
      ticketId: "ticket-1",
      messageId: "wa-msg-1",
      channel: "whatsapp"
    });
    expect(mocks.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterEmail: "whatsapp:+15551234567"
      })
    );
    expect(mocks.queueWhatsAppSend).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        to: "+15551234567",
        text: "Can I send the corrected invoice here?",
        origin: "human",
        actorUserId: "agent-1"
      })
    );
  });

  it("returns module-disabled when voice is switched off", async () => {
    mocks.isWorkspaceModuleEnabled.mockImplementation(async (moduleKey: string) => moduleKey !== "voice");

    const response = await POST(
      new Request("http://localhost/api/tickets/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactMode: "call",
          toPhone: "+15551234567",
          subject: "Call customer"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "voice"
    });
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });

  it("returns module-disabled when WhatsApp is switched off", async () => {
    mocks.isWorkspaceModuleEnabled.mockImplementation(
      async (moduleKey: string) => moduleKey !== "whatsapp"
    );

    const response = await POST(
      new Request("http://localhost/api/tickets/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactMode: "whatsapp",
          toPhone: "+15551234567",
          subject: "Invoice follow-up",
          description: "Can I send the corrected invoice here?"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "whatsapp"
    });
    expect(mocks.queueWhatsAppSend).not.toHaveBeenCalled();
  });
});
