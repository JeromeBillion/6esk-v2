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
  buildProfileMetadataPatch: vi.fn(),
  lookupPredictionProfile: vi.fn(),
  normalizeCallPhone: vi.fn(),
  queueOutboundCall: vi.fn(),
  queueWhatsAppSend: vi.fn(),
  createOutboundEmailTicket: vi.fn(),
  deliverPendingCallEvents: vi.fn(),
  getLatestVoiceConsentState: vi.fn(),
  syncVoiceConsentFromMetadata: vi.fn(),
  evaluateVoiceCallPolicy: vi.fn(),
  getHumanVoicePolicyFromEnv: vi.fn(),
  isWorkspaceModuleEnabled: vi.fn(),
  recordModuleUsageEvent: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  dbQuery: vi.fn(),
  putObject: vi.fn(),
  upsertExternalUserLink: vi.fn()
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

vi.mock("@/server/integrations/prediction-profile", () => ({
  buildProfileMetadataPatch: mocks.buildProfileMetadataPatch,
  lookupPredictionProfile: mocks.lookupPredictionProfile
}));

vi.mock("@/server/integrations/external-user-links", () => ({
  upsertExternalUserLink: mocks.upsertExternalUserLink
}));

vi.mock("@/server/calls/service", () => ({
  normalizeCallPhone: mocks.normalizeCallPhone,
  queueOutboundCall: mocks.queueOutboundCall
}));

vi.mock("@/server/whatsapp/send", () => ({
  queueWhatsAppSend: mocks.queueWhatsAppSend
}));

vi.mock("@/server/tickets/outbound-email", () => ({
  createOutboundEmailTicket: mocks.createOutboundEmailTicket
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

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject
}));

import { POST } from "@/app/api/tickets/create/route";

const ORIGINAL_ENV = { ...process.env };

describe("POST /api/tickets/create external identity enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      SUPPORT_ADDRESS: "support@6ex.co.za",
      INBOUND_SHARED_SECRET: "shared-secret"
    };

    mocks.getSessionUser.mockResolvedValue(null);
    mocks.canManageTickets.mockReturnValue(true);
    mocks.getOrCreateMailbox.mockResolvedValue({ id: "mailbox-1" });
    mocks.inferTagsFromText.mockReturnValue([]);
    mocks.createTicket.mockResolvedValue("ticket-1");
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.addTagsToTicket.mockResolvedValue(undefined);
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue({
      customerId: "customer-1",
      kind: "registered"
    });
    mocks.buildProfileMetadataPatch.mockReturnValue({});
    mocks.lookupPredictionProfile.mockResolvedValue({ status: "missed", durationMs: 5 });
    mocks.normalizeCallPhone.mockReturnValue("+27820000000");
    mocks.queueOutboundCall.mockResolvedValue({
      status: "queued",
      callSessionId: "call-1",
      messageId: "call-message-1"
    });
    mocks.queueWhatsAppSend.mockResolvedValue({
      status: "queued",
      messageId: "wa-message-1"
    });
    mocks.createOutboundEmailTicket.mockResolvedValue({
      ticketId: "ticket-1",
      messageId: "message-1"
    });
    mocks.deliverPendingCallEvents.mockResolvedValue(undefined);
    mocks.getLatestVoiceConsentState.mockResolvedValue(null);
    mocks.syncVoiceConsentFromMetadata.mockResolvedValue(false);
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({ allowed: true });
    mocks.getHumanVoicePolicyFromEnv.mockReturnValue({ voice: {} });
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
    mocks.buildAgentEvent.mockImplementation((payload) => ({
      id: `evt-${String(payload.eventType)}`,
      ...payload
    }));
    mocks.enqueueAgentEvent.mockResolvedValue(undefined);
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
    mocks.dbQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    mocks.putObject.mockResolvedValue("messages/message-1/body.txt");
    mocks.upsertExternalUserLink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("writes external-user link metadata and emits customer identity resolution for trusted inbound creates", async () => {
    const response = await POST(
      new Request("http://localhost/api/tickets/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "shared-secret"
        },
        body: JSON.stringify({
          from: "olivia.parker@brightpath.co",
          subject: "Help with onboarding",
          description: "Need someone to confirm the account owner.",
          metadata: {
            external_profile: {
              source: "prediction-market-mvp-webchat",
              externalUserId: "user-123",
              matchedBy: "session_auth",
              matchedAt: "2026-03-29T07:00:00.000Z",
              fullName: "Olivia Parker",
              email: "olivia.parker@brightpath.co",
              phoneNumber: "+27821234567",
              kycStatus: "verified",
              accountStatus: "active"
            },
            profile_lookup: {
              source: "prediction-market-mvp-webchat",
              status: "matched",
              matchedBy: "session_auth",
              lookupAt: "2026-03-29T07:00:00.000Z"
            }
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
    expect(mocks.lookupPredictionProfile).not.toHaveBeenCalled();
    expect(mocks.upsertExternalUserLink).toHaveBeenCalledWith({
      externalSystem: "prediction-market-mvp",
      profile: expect.objectContaining({
        id: "user-123",
        email: "olivia.parker@brightpath.co",
        phoneNumber: "+27821234567"
      }),
      matchedBy: "session_auth",
      inboundEmail: "olivia.parker@brightpath.co",
      ticketId: "ticket-1",
      channel: "email"
    });
    expect(mocks.recordTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        eventType: "profile_enriched",
        data: expect.objectContaining({
          source: "prediction-market-mvp",
          matchedBy: "session_auth",
          externalUserId: "user-123"
        })
      })
    );
    expect(mocks.enqueueAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "customer.identity.resolved",
        payload: expect.objectContaining({
          customer: {
            id: "customer-1",
            kind: "registered"
          },
          identity: {
            email: "olivia.parker@brightpath.co",
            phone: "+27821234567"
          },
          matchedByProfile: true
        })
      })
    );
    expect(mocks.recordModuleUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleKey: "email",
        usageKind: "ticket_created_inbound",
        actorType: "system"
      })
    );
  });

  it("records identity conflicts without rebinding external ownership on trusted inbound creates", async () => {
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue({
      customerId: "customer-1",
      kind: "registered",
      conflict: {
        type: "external_identity_conflict",
        externalSystem: "prediction-market-mvp",
        incomingExternalUserId: "user-123",
        existingExternalUserId: "user-999",
        existingExternalSystem: "prediction-market-mvp",
        existingCustomerId: "customer-1",
        matchedIdentity: "email"
      }
    });

    const response = await POST(
      new Request("http://localhost/api/tickets/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-secret": "shared-secret"
        },
        body: JSON.stringify({
          from: "olivia.parker@brightpath.co",
          subject: "Help with onboarding",
          description: "Need someone to confirm the account owner.",
          metadata: {
            external_profile: {
              source: "prediction-market-mvp-webchat",
              externalUserId: "user-123",
              matchedBy: "session_auth",
              matchedAt: "2026-03-29T07:00:00.000Z",
              fullName: "Olivia Parker",
              email: "olivia.parker@brightpath.co",
              phoneNumber: "+27821234567",
              kycStatus: "verified",
              accountStatus: "active"
            },
            profile_lookup: {
              source: "prediction-market-mvp-webchat",
              status: "matched",
              matchedBy: "session_auth",
              lookupAt: "2026-03-29T07:00:00.000Z"
            }
          }
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.upsertExternalUserLink).not.toHaveBeenCalled();
    expect(mocks.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          profile_lookup: expect.objectContaining({
            status: "conflicted",
            conflict: expect.objectContaining({
              incomingExternalUserId: "user-123",
              existingExternalUserId: "user-999"
            })
          }),
          external_profile_conflict: expect.objectContaining({
            externalUserId: "user-123"
          })
        })
      })
    );
    expect(mocks.recordTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        eventType: "customer_identity_conflict",
        data: expect.objectContaining({
          source: "prediction-market-mvp",
          matchedBy: "session_auth",
          conflict: expect.objectContaining({
            incomingExternalUserId: "user-123",
            existingExternalUserId: "user-999"
          })
        })
      })
    );
    expect(mocks.recordTicketEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        eventType: "profile_enriched"
      })
    );
    expect(mocks.enqueueAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "customer.identity.resolved",
        payload: expect.objectContaining({
          conflict: expect.objectContaining({
            incomingExternalUserId: "user-123",
            existingExternalUserId: "user-999"
          })
        })
      })
    );
  });
});
