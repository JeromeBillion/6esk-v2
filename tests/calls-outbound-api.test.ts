import { beforeEach, describe, expect, it, vi } from "vitest";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTicketById: vi.fn(),
  getTicketCallOptions: vi.fn(),
  resolveCallPhoneForRequest: vi.fn(),
  getLatestVoiceConsentState: vi.fn(),
  evaluateVoiceCallPolicy: vi.fn(),
  queueOutboundCall: vi.fn(),
  deliverPendingCallEvents: vi.fn(),
  recordAuditLog: vi.fn(),
  checkModuleEntitlement: vi.fn(),
  recordModuleUsageEvent: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/tickets", () => ({
  getTicketById: mocks.getTicketById
}));

vi.mock("@/server/calls/service", () => ({
  getTicketCallOptions: mocks.getTicketCallOptions,
  resolveCallPhoneForRequest: mocks.resolveCallPhoneForRequest,
  queueOutboundCall: mocks.queueOutboundCall
}));

vi.mock("@/server/calls/consent", () => ({
  getLatestVoiceConsentState: mocks.getLatestVoiceConsentState
}));

vi.mock("@/server/calls/policy", () => ({
  evaluateVoiceCallPolicy: mocks.evaluateVoiceCallPolicy,
  getHumanVoicePolicyFromEnv: vi.fn(() => ({ voice: {} }))
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/calls/outbox", () => ({
  deliverPendingCallEvents: mocks.deliverPendingCallEvents
}));

vi.mock("@/server/tenant/module-guard", () => ({
  checkModuleEntitlement: mocks.checkModuleEntitlement
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: mocks.recordModuleUsageEvent
}));

import { POST } from "@/app/api/calls/outbound/route";

async function postOutbound(body: Record<string, unknown>) {
  const response = await POST(
    new Request("http://localhost/api/calls/outbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
  const payload = await response.json();
  return { response, payload };
}

describe("POST /api/calls/outbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: AGENT_ID,
      email: "agent@6ex.co.za",
      display_name: "Agent",
      role_id: "role-1",
      role_name: "agent",
      tenant_id: TENANT_ID
    });
    mocks.getTicketById.mockResolvedValue({
      id: TICKET_ID,
      assigned_user_id: AGENT_ID
    });
    mocks.checkModuleEntitlement.mockResolvedValue(true);
    mocks.getTicketCallOptions.mockResolvedValue({
      ticketId: TICKET_ID,
      selectionRequired: false,
      defaultCandidateId: "primary",
      canManualDial: true,
      candidates: [
        {
          candidateId: "primary",
          phone: "+15551234567",
          label: "Primary",
          source: "customer_primary",
          isPrimary: true
        }
      ]
    });
    mocks.resolveCallPhoneForRequest.mockReturnValue({
      status: "resolved",
      phone: "+15551234567",
      selectedCandidateId: "primary"
    });
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({
      allowed: true
    });
    mocks.getLatestVoiceConsentState.mockResolvedValue({
      state: "unknown",
      callbackPhone: null,
      termsVersion: null,
      source: null,
      updatedAt: null,
      identityType: null,
      identityValue: null,
      customerId: null
    });
    mocks.queueOutboundCall.mockResolvedValue({
      status: "queued",
      callSessionId: "call-session-1",
      messageId: "message-1",
      toPhone: "+15551234567",
      idempotent: false
    });
    mocks.deliverPendingCallEvents.mockResolvedValue({ delivered: 0, skipped: 0, provider: "mock" });
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
  });

  it("returns 401 when user is not authenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, payload } = await postOutbound({
      ticketId: TICKET_ID,
      reason: "Follow-up call"
    });

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({ error: "Unauthorized" });
  });

  it("returns selection_required when resolver cannot pick a phone", async () => {
    mocks.resolveCallPhoneForRequest.mockReturnValue({
      status: "selection_required",
      errorCode: "selection_required",
      detail: "Select one number",
      defaultCandidateId: null,
      candidates: [
        { candidateId: "a", phone: "+15550000001", label: "A", source: "customer_primary", isPrimary: true },
        { candidateId: "b", phone: "+15550000002", label: "B", source: "customer_identity", isPrimary: false }
      ]
    });

    const { response, payload } = await postOutbound({
      ticketId: TICKET_ID,
      reason: "Follow-up call"
    });

    expect(response.status).toBe(409);
    expect(payload.status).toBe("selection_required");
    expect(payload.candidates).toHaveLength(2);
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("uses consent snapshot in policy evaluation and blocks revoked consent", async () => {
    mocks.getLatestVoiceConsentState.mockResolvedValue({
      state: "revoked",
      callbackPhone: "+15551234567",
      termsVersion: "v2.3",
      source: "help_center_self_service",
      updatedAt: "2026-02-19T10:00:00.000Z",
      identityType: "phone",
      identityValue: "+15551234567",
      customerId: null
    });
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({
      allowed: false,
      code: "consent_required",
      detail: "Voice consent has been revoked. Ask the customer to opt in again before calling."
    });

    const { response, payload } = await postOutbound({
      ticketId: TICKET_ID,
      reason: "Follow-up call"
    });

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      status: "blocked",
      errorCode: "consent_required"
    });
    expect(mocks.evaluateVoiceCallPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        consentState: expect.objectContaining({
          state: "revoked",
          callbackPhone: "+15551234567"
        })
      })
    );
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("returns blocked when voice policy denies the request", async () => {
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({
      allowed: false,
      code: "outside_allowed_hours",
      detail: "Voice calls are blocked outside allowed hours."
    });

    const { response, payload } = await postOutbound({
      ticketId: TICKET_ID,
      reason: "Follow-up call"
    });

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      status: "blocked",
      errorCode: "outside_allowed_hours"
    });
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("queues outbound call when phone is resolved", async () => {
    const { response, payload } = await postOutbound({
      ticketId: TICKET_ID,
      candidateId: "primary",
      reason: "Follow-up call",
      idempotencyKey: "call-1"
    });

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "queued",
      callSessionId: "call-session-1",
      messageId: "message-1",
      toPhone: "+15551234567"
    });
    expect(mocks.queueOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: TICKET_ID,
        tenantId: TENANT_ID,
        toPhone: "+15551234567",
        origin: "human",
        actorUserId: AGENT_ID
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "call_queued",
        tenantId: TENANT_ID,
        entityType: "call_session",
        entityId: "call-session-1",
        data: expect.objectContaining({
          ticketId: TICKET_ID,
          toPhone: "+1555******67",
          idempotent: false
        })
      })
    );
    expect(mocks.recordModuleUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        moduleKey: "voice",
        usageKind: "call_queued"
      })
    );
  });
});
