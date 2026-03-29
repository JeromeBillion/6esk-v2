import { beforeEach, describe, expect, it, vi } from "vitest";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";

const mocks = vi.hoisted(() => {
  class MergeError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  class MergeReviewError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  return {
    getAgentFromRequest: vi.fn(),
    createDraft: vi.fn(),
    hasMailboxScope: vi.fn(),
    isAutoSendAllowed: vi.fn(),
    buildAgentEvent: vi.fn(),
    deliverPendingAgentEvents: vi.fn(),
    enqueueAgentEvent: vi.fn(),
    recordAuditLog: vi.fn(),
    dbQuery: vi.fn(),
    sendTicketReply: vi.fn(),
    addTagsToTicket: vi.fn(),
    getTicketById: vi.fn(),
    recordTicketEvent: vi.fn(),
    mergeCustomers: vi.fn(),
    mergeTickets: vi.fn(),
    createMergeReviewTask: vi.fn(),
    getTicketCallOptions: vi.fn(),
    resolveCallPhoneForRequest: vi.fn(),
    getLatestVoiceConsentState: vi.fn(),
    evaluateVoiceCallPolicy: vi.fn(),
    queueOutboundCall: vi.fn(),
    isWorkspaceModuleEnabled: vi.fn(),
    recordModuleUsageEvent: vi.fn(),
    MergeError,
    MergeReviewError
  };
});

vi.mock("@/server/agents/auth", () => ({
  getAgentFromRequest: mocks.getAgentFromRequest
}));
vi.mock("@/server/agents/drafts", () => ({
  createDraft: mocks.createDraft
}));
vi.mock("@/server/agents/scopes", () => ({
  hasMailboxScope: mocks.hasMailboxScope
}));
vi.mock("@/server/agents/policy", () => ({
  isAutoSendAllowed: mocks.isAutoSendAllowed
}));
vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));
vi.mock("@/server/agents/outbox", () => ({
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents,
  enqueueAgentEvent: mocks.enqueueAgentEvent
}));
vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));
vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));
vi.mock("@/server/email/replies", () => ({
  sendTicketReply: mocks.sendTicketReply
}));
vi.mock("@/server/tickets", () => ({
  addTagsToTicket: mocks.addTagsToTicket,
  getTicketById: mocks.getTicketById,
  recordTicketEvent: mocks.recordTicketEvent
}));
vi.mock("@/server/merges", () => ({
  mergeCustomers: mocks.mergeCustomers,
  mergeTickets: mocks.mergeTickets,
  MergeError: mocks.MergeError
}));
vi.mock("@/server/merge-reviews", () => ({
  createMergeReviewTask: mocks.createMergeReviewTask,
  MergeReviewError: mocks.MergeReviewError
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
  evaluateVoiceCallPolicy: mocks.evaluateVoiceCallPolicy
}));

vi.mock("@/server/workspace-modules", () => ({
  DEFAULT_WORKSPACE_KEY: "primary",
  isWorkspaceModuleEnabled: mocks.isWorkspaceModuleEnabled
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: mocks.recordModuleUsageEvent,
  resolveAiProviderMode: () => "managed"
}));

import { POST } from "@/app/api/agent/v1/actions/route";

async function postAction(action: Record<string, unknown>) {
  const request = new Request("http://localhost/api/agent/v1/actions", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ action })
  });
  const response = await POST(request);
  const body = await response.json();
  return { response, body };
}

describe("agent initiate_call action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-voice",
      status: "active",
      policy_mode: "auto_send",
      scopes: {},
      capabilities: { allow_voice_actions: true }
    });
    mocks.hasMailboxScope.mockReturnValue(true);
    mocks.getTicketById.mockResolvedValue({
      id: TICKET_ID,
      mailbox_id: "mailbox-1"
    });
    mocks.getTicketCallOptions.mockResolvedValue({
      ticketId: TICKET_ID,
      selectionRequired: false,
      defaultCandidateId: "primary",
      canManualDial: true,
      candidates: [
        {
          candidateId: "primary",
          phone: "+15551234567",
          label: "Primary phone",
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
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);
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
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
  });

  it("blocks when allowVoiceActions capability is disabled", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-voice",
      status: "active",
      policy_mode: "auto_send",
      scopes: {},
      capabilities: {}
    });

    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Follow-up by phone"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "blocked",
      detail: "Voice actions disabled"
    });
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("blocks when latest consent state is revoked", async () => {
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

    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Need a customer call"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "blocked"
    });
    expect(body.results[0].data).toMatchObject({
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

  it("returns selection_required with candidate payload when selection is needed", async () => {
    mocks.resolveCallPhoneForRequest.mockReturnValue({
      status: "selection_required",
      errorCode: "selection_required",
      detail: "Select a number",
      defaultCandidateId: null,
      candidates: [
        { candidateId: "a", phone: "+15550000001", label: "A", source: "customer_primary", isPrimary: true },
        { candidateId: "b", phone: "+15550000002", label: "B", source: "customer_identity", isPrimary: false }
      ]
    });

    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Need a customer call"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "selection_required",
      detail: "Select a number"
    });
    expect(body.results[0].data.candidates).toHaveLength(2);
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("returns blocked when voice policy denies the call", async () => {
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({
      allowed: false,
      code: "rate_limited",
      detail: "Voice call limit reached (10 calls/hour)."
    });

    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Need a customer call"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "blocked",
      detail: "Voice call limit reached (10 calls/hour)."
    });
    expect(body.results[0].data).toMatchObject({
      errorCode: "rate_limited"
    });
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("queues call when candidate is resolved", async () => {
    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Proactive phone resolution",
      candidateId: "primary",
      idempotencyKey: "wf-1:step-1"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "ok"
    });
    expect(body.results[0].data).toMatchObject({
      callSessionId: "call-session-1",
      messageId: "message-1",
      toPhone: "+15551234567"
    });
    expect(mocks.queueOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: TICKET_ID,
        toPhone: "+15551234567",
        reason: "Proactive phone resolution",
        origin: "ai",
        actorIntegrationId: "agent-voice"
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_call_queued",
        entityType: "call_session",
        entityId: "call-session-1",
        data: expect.objectContaining({
          agentId: "agent-voice",
          ticketId: TICKET_ID,
          toPhone: "+1555******67",
          idempotent: false
        })
      })
    );
  });

  it("allows manual phone entry with toPhone parameter", async () => {
    mocks.resolveCallPhoneForRequest.mockReturnValue({
      status: "resolved",
      phone: "+1-555-999-8888",
      selectedCandidateId: null
    });

    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Manual override call",
      toPhone: "+1-555-999-8888"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "ok"
    });
    expect(mocks.resolveCallPhoneForRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        toPhone: "+1-555-999-8888"
      })
    );
    expect(mocks.queueOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toPhone: "+1-555-999-8888"
      })
    );
  });

  it("returns blocked when ticket not found", async () => {
    mocks.getTicketById.mockResolvedValue(null);

    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Follow-up call"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "not_found"
    });
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("blocks when user lacks mailbox scope", async () => {
    mocks.hasMailboxScope.mockReturnValue(false);

    const { response } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Call for verification"
    });

    expect(response.status).toBe(403);
  });

  it("blocks when policy blocks call outside working hours", async () => {
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({
      allowed: false,
      code: "outside_allowed_hours",
      detail: "Calls only allowed 9 AM - 5 PM EST (Mon-Fri)"
    });

    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Support callback",
      candidateId: "primary"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "blocked",
      detail: "Calls only allowed 9 AM - 5 PM EST (Mon-Fri)"
    });
    expect(body.results[0].data).toMatchObject({
      errorCode: "outside_allowed_hours"
    });
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("supports idempotency key for duplicate request handling", async () => {
    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Retry attempt",
      candidateId: "primary",
      idempotencyKey: "retry-key-123"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "ok"
    });
    expect(mocks.queueOutboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "retry-key-123"
      })
    );
  });

  it("rejects call when phone resolution returns failed status", async () => {
    mocks.resolveCallPhoneForRequest.mockReturnValue({
      status: "failed",
      errorCode: "missing_phone",
      detail: "No phone number available and manual dial required"
    });

    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Need to call"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "failed",
      detail: "No phone number available and manual dial required"
    });
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("includes required reason field in validation", async () => {
    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID
      // reason field intentionally missing
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "initiate_call",
      status: "failed"
    });
    expect(body.results[0].detail).toMatch(/reason|required/i);
    expect(mocks.queueOutboundCall).not.toHaveBeenCalled();
  });

  it("passes consent state to policy evaluation", async () => {
    const consentState = {
      state: "granted",
      callbackPhone: "+15551234567",
      termsVersion: "v2.1",
      source: "inbound_call_consent_audio_prompt",
      updatedAt: "2026-02-20T14:30:00.000Z",
      identityType: "phone",
      identityValue: "+15551234567",
      customerId: "cust-123"
    };
    mocks.getLatestVoiceConsentState.mockResolvedValue(consentState);

    const { response, body } = await postAction({
      type: "initiate_call",
      ticketId: TICKET_ID,
      reason: "Callback based on consent",
      candidateId: "primary"
    });

    expect(response.status).toBe(200);
    expect(body.results[0].status).toBe("ok");
    expect(mocks.evaluateVoiceCallPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        consentState: expect.objectContaining({
          state: "granted",
          callbackPhone: "+15551234567"
        })
      })
    );
  });
});
