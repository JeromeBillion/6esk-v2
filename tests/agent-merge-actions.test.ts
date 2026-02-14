import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { POST } from "@/app/api/agent/v1/actions/route";

const TICKET_A = "11111111-1111-1111-1111-111111111111";
const TICKET_B = "22222222-2222-2222-2222-222222222222";
const CUSTOMER_A = "33333333-3333-3333-3333-333333333333";
const CUSTOMER_B = "44444444-4444-4444-4444-444444444444";

function makeTicket(id: string, mailboxId = "mailbox-1") {
  return {
    id,
    mailbox_id: mailboxId
  };
}

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

describe("agent merge actions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: {}
    });
    mocks.hasMailboxScope.mockReturnValue(true);
    mocks.getTicketById.mockImplementation(async (ticketId: string) => {
      if (ticketId === TICKET_A || ticketId === TICKET_B) return makeTicket(ticketId);
      return null;
    });
    mocks.createMergeReviewTask.mockResolvedValue({ id: "review-1" });
    mocks.buildAgentEvent.mockReturnValue({
      id: "evt-1",
      eventType: "merge.review.required",
      ticketId: TICKET_A,
      mailboxId: "mailbox-1"
    });
    mocks.mergeTickets.mockResolvedValue({
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      channel: "email",
      movedMessages: 1,
      movedReplies: 1,
      movedEvents: 1,
      movedDrafts: 1
    });
    mocks.mergeCustomers.mockResolvedValue({
      sourceCustomerId: CUSTOMER_A,
      targetCustomerId: CUSTOMER_B,
      movedTickets: 1,
      movedIdentities: 1
    });
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.enqueueAgentEvent.mockResolvedValue(undefined);
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
    mocks.dbQuery.mockResolvedValue({ rowCount: 1, rows: [] });
  });

  it("blocks direct merge when allowMergeActions capability is disabled", async () => {
    const { response, body } = await postAction({
      type: "merge_tickets",
      ticketId: TICKET_A,
      targetTicketId: TICKET_B,
      reason: "Duplicate case",
      confidence: 0.99
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "merge_tickets",
      status: "blocked",
      detail: "Merge actions disabled"
    });
    expect(mocks.mergeTickets).not.toHaveBeenCalled();
  });

  it("rejects propose_merge payload that mixes ticket and customer merge fields", async () => {
    const { response, body } = await postAction({
      type: "propose_merge",
      ticketId: TICKET_A,
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      sourceCustomerId: CUSTOMER_A,
      targetCustomerId: CUSTOMER_B,
      reason: "Duplicate identity and issue",
      confidence: 0.95
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "propose_merge",
      status: "failed",
      detail: "Provide either ticket merge fields or customer merge fields, not both."
    });
    expect(mocks.createMergeReviewTask).not.toHaveBeenCalled();
  });

  it("requires explicit reason and minimum confidence for propose_merge", async () => {
    const missingReason = await postAction({
      type: "propose_merge",
      ticketId: TICKET_A,
      targetTicketId: TICKET_B,
      confidence: 0.95
    });
    expect(missingReason.body.results[0]).toMatchObject({
      type: "propose_merge",
      status: "failed",
      detail: "Merge reason is required."
    });

    const lowConfidence = await postAction({
      type: "propose_merge",
      ticketId: TICKET_A,
      targetTicketId: TICKET_B,
      reason: "Likely duplicate conversation",
      confidence: 0.4
    });
    expect(lowConfidence.body.results[0]).toMatchObject({
      type: "propose_merge",
      status: "failed"
    });
    expect(lowConfidence.body.results[0].detail).toContain("below minimum");
    expect(mocks.createMergeReviewTask).not.toHaveBeenCalled();
  });

  it("creates review task and emits merge.review.required event for valid propose_merge", async () => {
    const { response, body } = await postAction({
      type: "propose_merge",
      ticketId: TICKET_A,
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      reason: "Customer opened duplicate escalation thread",
      confidence: 0.98,
      metadata: { channel: "email" }
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({ type: "propose_merge", status: "ok" });
    expect(mocks.createMergeReviewTask).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalType: "ticket",
        sourceTicketId: TICKET_A,
        targetTicketId: TICKET_B,
        reason: "Customer opened duplicate escalation thread",
        confidence: 0.98
      })
    );
    expect(mocks.enqueueAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "merge.review.required"
      })
    );
  });

  it("enforces confidence threshold before merge_tickets execution", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: { allow_merge_actions: true }
    });

    const { response, body } = await postAction({
      type: "merge_tickets",
      ticketId: TICKET_A,
      targetTicketId: TICKET_B,
      reason: "Clearly duplicate threads",
      confidence: 0.2
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "merge_tickets",
      status: "failed"
    });
    expect(body.results[0].detail).toContain("below minimum");
    expect(mocks.mergeTickets).not.toHaveBeenCalled();
  });

  it("executes merge_tickets when capability and safety checks pass", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: { allow_merge_actions: true }
    });

    const { response, body } = await postAction({
      type: "merge_tickets",
      ticketId: TICKET_A,
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      reason: "Same issue duplicated by customer follow-up",
      confidence: 0.97
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "merge_tickets",
      status: "ok"
    });
    expect(mocks.mergeTickets).toHaveBeenCalledWith({
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      actorUserId: null,
      reason: "Same issue duplicated by customer follow-up"
    });
  });

  it("requires safety fields for merge_customers too", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: { allow_merge_actions: true }
    });

    const { response, body } = await postAction({
      type: "merge_customers",
      ticketId: TICKET_A,
      sourceCustomerId: CUSTOMER_A,
      targetCustomerId: CUSTOMER_B,
      confidence: 0.95
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "merge_customers",
      status: "failed",
      detail: "Merge reason is required."
    });
    expect(mocks.mergeCustomers).not.toHaveBeenCalled();
  });
});

