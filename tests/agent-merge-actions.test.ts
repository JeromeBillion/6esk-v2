import { createHash } from "crypto";
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
    getCustomerById: vi.fn(),
    getTicketById: vi.fn(),
    recordTicketEvent: vi.fn(),
    mergeCustomers: vi.fn(),
    mergeTickets: vi.fn(),
    linkTickets: vi.fn(),
    createMergeReviewTask: vi.fn(),
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
vi.mock("@/server/customers", () => ({
  getCustomerById: mocks.getCustomerById
}));
vi.mock("@/server/merges", () => ({
  mergeCustomers: mocks.mergeCustomers,
  mergeTickets: mocks.mergeTickets,
  linkTickets: mocks.linkTickets,
  MergeError: mocks.MergeError
}));
vi.mock("@/server/merge-reviews", () => ({
  createMergeReviewTask: mocks.createMergeReviewTask,
  MergeReviewError: mocks.MergeReviewError
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

const TICKET_A = "11111111-1111-1111-1111-111111111111";
const TICKET_B = "22222222-2222-2222-2222-222222222222";
const CUSTOMER_A = "33333333-3333-3333-3333-333333333333";
const CUSTOMER_B = "44444444-4444-4444-4444-444444444444";
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const FOREIGN_TENANT_ID = "99999999-9999-4999-8999-999999999999";

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

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableJson(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeForStableJson(entryValue)])
  );
}

function actionRequestHash(action: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeForStableJson({ ...action, idempotencyKey: undefined })))
    .digest("hex");
}

function mockActionIdempotencyClaim(id = "idem-1") {
  mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });
  mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id }] });
}

describe("agent merge actions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockReset();
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: {}
    });
    mocks.hasMailboxScope.mockReturnValue(true);
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
    mocks.getTicketById.mockImplementation(async (ticketId: string) => {
      if (ticketId === TICKET_A || ticketId === TICKET_B) return makeTicket(ticketId);
      return null;
    });
    mocks.getCustomerById.mockImplementation(async (customerId: string) => {
      if (customerId === CUSTOMER_A || customerId === CUSTOMER_B) {
        return { id: customerId, tenant_id: TENANT_ID };
      }
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
    mocks.linkTickets.mockResolvedValue({
      id: "link-1",
      relationshipType: "linked_case",
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      sourceChannel: "email",
      targetChannel: "whatsapp",
      linkedAt: "2026-03-28T00:00:00.000Z"
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

  it("rate limits agent action bursts before ticket side effects", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: { max_actions_per_minute: 1 }
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 1 }] });

    const { response, body } = await postAction({
      type: "draft_reply",
      ticketId: TICKET_A,
      text: "Draft response"
    });

    expect(response.status).toBe(429);
    expect(body).toMatchObject({
      code: "agent_action_rate_limited",
      limit: 1,
      windowSeconds: 60
    });
    expect(mocks.getTicketById).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action_rate_limited",
        entityType: "agent_integration",
        entityId: "agent-1"
      })
    );
  });

  it("records non-call action idempotency before creating draft side effects", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: "idem-1" }] });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const action = {
      type: "draft_reply",
      ticketId: TICKET_A,
      text: "Draft response",
      idempotencyKey: "draft-1"
    };

    const { response, body } = await postAction(action);

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "draft_reply",
      status: "ok"
    });
    expect(mocks.createDraft).toHaveBeenCalledTimes(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_action_idempotency"),
      expect.arrayContaining([TENANT_ID, "agent-1", "draft-1", "draft_reply", TICKET_A])
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("response = $6::jsonb"),
      expect.arrayContaining([TENANT_ID, "agent-1", "draft-1"])
    );
  });

  it("deduplicates replayed non-call action side effects from the ledger", async () => {
    const action = {
      type: "draft_reply",
      ticketId: TICKET_A,
      text: "Draft response",
      idempotencyKey: "draft-replay-1"
    };
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          request_hash: actionRequestHash(action),
          status: "completed",
          response: { type: "draft_reply", status: "ok" }
        }
      ]
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const { response, body } = await postAction(action);

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "draft_reply",
      status: "ok",
      data: {
        idempotencyKey: "draft-replay-1",
        deduplicated: true
      }
    });
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.recordTicketEvent).not.toHaveBeenCalled();
  });

  it("rejects reused idempotency keys with different action payloads", async () => {
    const action = {
      type: "draft_reply",
      ticketId: TICKET_A,
      text: "Changed draft response",
      idempotencyKey: "draft-conflict-1"
    };
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          request_hash: actionRequestHash({ ...action, text: "Original draft response" }),
          status: "completed",
          response: { type: "draft_reply", status: "ok" }
        }
      ]
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const { response, body } = await postAction(action);

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "draft_reply",
      status: "failed",
      detail: "idempotencyKey was already used for a different action payload.",
      data: {
        idempotencyKey: "draft-conflict-1",
        errorCode: "idempotency_conflict"
      }
    });
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action_idempotency_conflict",
        entityType: "ticket",
        entityId: TICKET_A
      })
    );
  });

  it("dry-runs agent actions without executing ticket side effects", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "auto_send",
      scopes: {},
      capabilities: {},
      policy: { actionRolloutMode: "dry_run" }
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });

    const { response, body } = await postAction({
      type: "draft_reply",
      ticketId: TICKET_A,
      text: "Draft response"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "draft_reply",
      status: "dry_run",
      detail: "Dry-run mode; no side effects executed.",
      data: {
        rolloutMode: "dry_run",
        wouldExecute: "draft_reply"
      }
    });
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.recordTicketEvent).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action_dry_run",
        entityType: "ticket",
        entityId: TICKET_A,
        data: expect.objectContaining({
          rolloutMode: "dry_run",
          actionType: "draft_reply"
        })
      })
    );
  });

  it("blocks direct mutations in explicit draft-only rollout mode", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "auto_send",
      scopes: {},
      capabilities: {},
      policy: { actionRolloutMode: "draft_only" }
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });

    const { response, body } = await postAction({
      type: "set_priority",
      ticketId: TICKET_A,
      priority: "urgent"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "set_priority",
      status: "blocked",
      detail: "Action blocked by draft-only AI rollout mode.",
      data: {
        rolloutMode: "draft_only",
        errorCode: "action_rollout_blocked"
      }
    });
    expect(mocks.dbQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE tickets SET priority"),
      expect.anything()
    );
    expect(mocks.recordTicketEvent).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action_rollout_blocked",
        entityId: TICKET_A
      })
    );
  });

  it("blocks customer contact in limited auto mode unless explicitly allowlisted", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "auto_send",
      scopes: {},
      capabilities: {},
      policy: { actionRolloutMode: "limited_auto" }
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });

    const { response, body } = await postAction({
      type: "send_reply",
      ticketId: TICKET_A,
      subject: "Update",
      text: "Customer-facing response"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "send_reply",
      status: "blocked",
      detail: "Action blocked by limited auto-action rollout mode.",
      data: {
        rolloutMode: "limited_auto",
        errorCode: "action_rollout_blocked"
      }
    });
    expect(mocks.isAutoSendAllowed).not.toHaveBeenCalled();
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
  });

  it("allows explicitly allowlisted customer contact in limited auto mode", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "auto_send",
      scopes: {},
      capabilities: {},
      policy: {
        actionRolloutMode: "limited_auto",
        allowedAutoActions: ["send_reply"]
      }
    });
    mocks.isAutoSendAllowed.mockReturnValue(true);
    mockActionIdempotencyClaim("send-allowlisted-1");

    const { response, body } = await postAction({
      type: "send_reply",
      ticketId: TICKET_A,
      subject: "Update",
      text: "Customer-facing response",
      idempotencyKey: "send-allowlisted-1"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "send_reply",
      status: "ok"
    });
    expect(mocks.sendTicketReply).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        ticketId: TICKET_A,
        origin: "ai"
      })
    );
  });

  it("requires idempotencyKey before auto-sending a reply", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "auto_send",
      scopes: {},
      capabilities: {}
    });
    mocks.isAutoSendAllowed.mockReturnValue(true);
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });

    const { response, body } = await postAction({
      type: "send_reply",
      ticketId: TICKET_A,
      subject: "Update",
      text: "Customer-facing response"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "send_reply",
      status: "failed",
      detail: "idempotencyKey is required for this AI action.",
      data: {
        errorCode: "idempotency_required"
      }
    });
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action_idempotency_required",
        entityId: TICKET_A,
        data: expect.objectContaining({
          actionType: "send_reply"
        })
      })
    );
  });

  it("does not use unscoped ticket lookup for primary action tickets", async () => {
    mocks.getTicketById.mockImplementation(async (ticketId: string, tenantId?: string) => {
      if (!tenantId && ticketId === TICKET_A) {
        return makeTicket(TICKET_A, "foreign-mailbox");
      }
      return null;
    });
    mocks.dbQuery.mockResolvedValue({ rows: [{ used: 0 }], rowCount: 1 });

    const cases = [
      {
        action: {
          type: "draft_reply",
          ticketId: TICKET_A,
          text: "Draft response"
        },
        sideEffect: mocks.createDraft
      },
      {
        action: {
          type: "set_tags",
          ticketId: TICKET_A,
          tags: ["urgent"],
          idempotencyKey: "tenant-tags-1"
        },
        sideEffect: mocks.addTagsToTicket
      },
      {
        action: {
          type: "set_priority",
          ticketId: TICKET_A,
          priority: "urgent",
          idempotencyKey: "tenant-priority-1"
        },
        sideEffect: mocks.recordTicketEvent
      },
      {
        action: {
          type: "assign_to",
          ticketId: TICKET_A,
          assignedUserId: null,
          idempotencyKey: "tenant-assign-1"
        },
        sideEffect: mocks.recordTicketEvent
      },
      {
        action: {
          type: "request_human_review",
          ticketId: TICKET_A,
          idempotencyKey: "tenant-review-1",
          metadata: { reason: "Needs human confirmation" }
        },
        sideEffect: mocks.recordTicketEvent
      }
    ];

    for (const { action, sideEffect } of cases) {
      vi.clearAllMocks();
      mocks.getAgentFromRequest.mockResolvedValue({
        id: "agent-1",
        tenant_id: TENANT_ID,
        status: "active",
        policy_mode: "manual",
        scopes: {},
        capabilities: {}
      });
      mocks.hasMailboxScope.mockReturnValue(true);
      mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);
      mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
      mocks.recordAuditLog.mockResolvedValue(undefined);
      mocks.dbQuery.mockResolvedValue({ rows: [{ used: 0 }], rowCount: 1 });
      mocks.getTicketById.mockImplementation(async (ticketId: string, tenantId?: string) => {
        if (!tenantId && ticketId === TICKET_A) {
          return makeTicket(TICKET_A, "foreign-mailbox");
        }
        return null;
      });

      const { response, body } = await postAction(action);

      expect(response.status).toBe(200);
      expect(body.results[0]).toMatchObject({
        type: action.type,
        status: "not_found"
      });
      expect(mocks.getTicketById).toHaveBeenCalledWith(TICKET_A, TENANT_ID);
      expect(sideEffect).not.toHaveBeenCalled();
      expect(mocks.recordAuditLog).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: "ai_action_idempotency_required"
        })
      );
    }
  });

  it("rejects cross-tenant merge targets before direct merge execution", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: { allow_merge_actions: true }
    });
    mocks.getTicketById.mockImplementation(async (ticketId: string, tenantId?: string) => {
      if (tenantId === TENANT_ID && ticketId === TICKET_A) return makeTicket(TICKET_A);
      if (!tenantId && ticketId === TICKET_B) return makeTicket(TICKET_B, "foreign-mailbox");
      return null;
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });

    const { response, body } = await postAction({
      type: "merge_tickets",
      ticketId: TICKET_A,
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      reason: "Duplicate case",
      confidence: 0.97
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "merge_tickets",
      status: "not_found",
      detail: "Target ticket not found"
    });
    expect(mocks.getTicketById).toHaveBeenCalledWith(TICKET_B, TENANT_ID);
    expect(mocks.mergeTickets).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant customer merge ids before direct customer merge execution", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: { allow_merge_actions: true }
    });
    mocks.getCustomerById.mockImplementation(async (customerId: string, tenantId?: string) => {
      if (tenantId === TENANT_ID && customerId === CUSTOMER_A) {
        return { id: CUSTOMER_A, tenant_id: TENANT_ID };
      }
      if (!tenantId && customerId === CUSTOMER_B) {
        return { id: CUSTOMER_B, tenant_id: FOREIGN_TENANT_ID };
      }
      return null;
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });

    const { response, body } = await postAction({
      type: "merge_customers",
      ticketId: TICKET_A,
      sourceCustomerId: CUSTOMER_A,
      targetCustomerId: CUSTOMER_B,
      reason: "Same customer",
      confidence: 0.98
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "merge_customers",
      status: "not_found",
      detail: "Source or target customer not found for customer merge."
    });
    expect(mocks.getCustomerById).toHaveBeenCalledWith(CUSTOMER_B, TENANT_ID);
    expect(mocks.mergeCustomers).not.toHaveBeenCalled();
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

  it("accepts mixed merge hints when metadata explicitly requests customer merge", async () => {
    mockActionIdempotencyClaim("propose-customer-1");

    const { response, body } = await postAction({
      type: "propose_merge",
      ticketId: TICKET_A,
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      sourceCustomerId: CUSTOMER_A,
      targetCustomerId: CUSTOMER_B,
      reason: "Same customer issue moved across channels",
      confidence: 0.95,
      idempotencyKey: "propose-customer-1",
      metadata: {
        proposalType: "customer_merge",
        linkedTicketIds: {
          sourceTicketId: TICKET_A,
          targetTicketId: TICKET_B
        }
      }
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "propose_merge",
      status: "ok"
    });
    expect(mocks.createMergeReviewTask).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalType: "customer",
        sourceCustomerId: CUSTOMER_A,
        targetCustomerId: CUSTOMER_B
      })
    );
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
    mockActionIdempotencyClaim("propose-ticket-1");

    const { response, body } = await postAction({
      type: "propose_merge",
      ticketId: TICKET_A,
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      reason: "Customer opened duplicate escalation thread",
      confidence: 0.98,
      idempotencyKey: "propose-ticket-1",
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

  it("creates linked_case merge reviews when metadata explicitly requests ticket linkage", async () => {
    mockActionIdempotencyClaim("propose-link-1");

    const { response, body } = await postAction({
      type: "propose_merge",
      ticketId: TICKET_A,
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      sourceCustomerId: CUSTOMER_A,
      targetCustomerId: CUSTOMER_B,
      reason: "Same customer moved from email into WhatsApp follow-up",
      confidence: 0.96,
      idempotencyKey: "propose-link-1",
      metadata: {
        proposalType: "linked_case"
      }
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "propose_merge",
      status: "ok"
    });
    expect(mocks.createMergeReviewTask).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalType: "linked_case",
        sourceTicketId: TICKET_A,
        targetTicketId: TICKET_B
      })
    );
  });

  it("enforces confidence threshold before merge_tickets execution", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
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
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: { allow_merge_actions: true }
    });
    mockActionIdempotencyClaim("merge-ticket-1");

    const { response, body } = await postAction({
      type: "merge_tickets",
      ticketId: TICKET_A,
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      reason: "Same issue duplicated by customer follow-up",
      confidence: 0.97,
      idempotencyKey: "merge-ticket-1"
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

  it("requires idempotencyKey before direct ticket merge execution", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: { allow_merge_actions: true }
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });

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
      status: "failed",
      detail: "idempotencyKey is required for this AI action.",
      data: {
        errorCode: "idempotency_required"
      }
    });
    expect(mocks.mergeTickets).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action_idempotency_required",
        entityId: TICKET_A,
        data: expect.objectContaining({
          actionType: "merge_tickets"
        })
      })
    );
  });

  it("requires safety fields for merge_customers too", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
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

  it("executes link_tickets when capability and safety checks pass", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "manual",
      scopes: {},
      capabilities: { allow_merge_actions: true }
    });
    mockActionIdempotencyClaim("link-ticket-1");

    const { response, body } = await postAction({
      type: "link_tickets",
      ticketId: TICKET_A,
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      reason: "Same issue continued on WhatsApp",
      confidence: 0.93,
      idempotencyKey: "link-ticket-1",
      metadata: { proposalType: "linked_case" }
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "link_tickets",
      status: "ok"
    });
    expect(mocks.linkTickets).toHaveBeenCalledWith({
      sourceTicketId: TICKET_A,
      targetTicketId: TICKET_B,
      actorUserId: null,
      reason: "Same issue continued on WhatsApp",
      metadata: { proposalType: "linked_case" }
    });
  });

  it("escalates send_reply outside working hours to draft + tag when policy is draft_only", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "auto_send",
      scopes: {},
      capabilities: {},
      policy: {
        escalation: {
          out_of_hours: "draft_only",
          tag: "urgent"
        }
      }
    });
    mocks.isAutoSendAllowed.mockReturnValue(false);
    mockActionIdempotencyClaim("send-escalation-1");

    const { response, body } = await postAction({
      type: "send_reply",
      ticketId: TICKET_A,
      subject: "Update",
      text: "Follow-up response",
      idempotencyKey: "send-escalation-1"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "send_reply",
      status: "blocked"
    });
    expect(body.results[0].detail).toContain("draft created");
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: "agent-1",
        ticketId: TICKET_A,
        subject: "Update",
        bodyText: "Follow-up response"
      })
    );
    expect(mocks.addTagsToTicket).toHaveBeenCalledWith(TICKET_A, ["urgent"]);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_reply_escalated_out_of_hours",
        entityId: TICKET_A
      })
    );
  });

  it("requires idempotencyKey before mutating ticket priority", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });

    const { response, body } = await postAction({
      type: "set_priority",
      ticketId: TICKET_A,
      priority: "urgent"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "set_priority",
      status: "failed",
      detail: "idempotencyKey is required for this AI action.",
      data: {
        errorCode: "idempotency_required"
      }
    });
    expect(mocks.dbQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE tickets SET priority"),
      expect.anything()
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_action_idempotency_required",
        entityId: TICKET_A,
        data: expect.objectContaining({
          actionType: "set_priority"
        })
      })
    );
  });

  it("blocks send_reply outside working hours without draft when escalation mode is block", async () => {
    mocks.getAgentFromRequest.mockResolvedValue({
      id: "agent-1",
      tenant_id: TENANT_ID,
      status: "active",
      policy_mode: "auto_send",
      scopes: {},
      capabilities: {},
      policy: {
        escalation: {
          out_of_hours: "block",
          tag: "urgent"
        }
      }
    });
    mocks.isAutoSendAllowed.mockReturnValue(false);

    const { response, body } = await postAction({
      type: "send_reply",
      ticketId: TICKET_A,
      text: "Follow-up response"
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "send_reply",
      status: "blocked",
      detail: "Outside working hours"
    });
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.addTagsToTicket).not.toHaveBeenCalled();
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
  });

  it("requires idempotencyKey when request_human_review includes call session metadata", async () => {
    const { response, body } = await postAction({
      type: "request_human_review",
      ticketId: TICKET_A,
      metadata: {
        callSessionId: "55555555-5555-4555-8555-555555555555",
        summary: "Customer asked for payout follow-up."
      }
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "request_human_review",
      status: "failed",
      detail: "idempotencyKey is required when metadata.callSessionId is provided."
    });
    expect(mocks.recordTicketEvent).not.toHaveBeenCalled();
  });

  it("deduplicates repeated request_human_review writebacks by callSessionId + idempotencyKey", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });
    mocks.dbQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const { response, body } = await postAction({
      type: "request_human_review",
      ticketId: TICKET_A,
      idempotencyKey: "summary-1",
      metadata: {
        callSessionId: "66666666-6666-4666-8666-666666666666",
        summary: "Duplicate summary payload"
      }
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "request_human_review",
      status: "ok",
      detail: "Duplicate review writeback ignored.",
      data: {
        callSessionId: "66666666-6666-4666-8666-666666666666",
        idempotencyKey: "summary-1",
        deduplicated: true
      }
    });
    expect(mocks.recordTicketEvent).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_review_writeback_deduplicated",
        entityType: "call_session",
        entityId: "66666666-6666-4666-8666-666666666666"
      })
    );
  });

  it("records first-time request_human_review writeback and returns deterministic metadata", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ used: 0 }] });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: "writeback-1" }] });

    const { response, body } = await postAction({
      type: "request_human_review",
      ticketId: TICKET_A,
      idempotencyKey: "summary-2",
      metadata: {
        callSessionId: "77777777-7777-4777-8777-777777777777",
        summary: "Customer requested escalation callback."
      }
    });

    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({
      type: "request_human_review",
      status: "ok",
      data: {
        callSessionId: "77777777-7777-4777-8777-777777777777",
        idempotencyKey: "summary-2",
        deduplicated: false
      }
    });
    expect(mocks.recordTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: TICKET_A,
        eventType: "ai_review_requested"
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_review_requested",
        entityType: "ticket",
        entityId: TICKET_A,
        data: expect.objectContaining({
          callSessionId: "77777777-7777-4777-8777-777777777777",
          idempotencyKey: "summary-2"
        })
      })
    );
  });
});
