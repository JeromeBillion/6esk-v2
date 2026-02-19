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
});
