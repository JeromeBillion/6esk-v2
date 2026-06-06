import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MergeReviewError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  return {
    getSessionUser: vi.fn(),
    getMergeReviewTaskForUser: vi.fn(),
    resolveMergeReviewTask: vi.fn(),
    recordAuditLog: vi.fn(),
    recordTicketEvent: vi.fn(),
    MergeReviewError
  };
});

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/merge-reviews", () => ({
  getMergeReviewTaskForUser: mocks.getMergeReviewTaskForUser,
  resolveMergeReviewTask: mocks.resolveMergeReviewTask,
  MergeReviewError: mocks.MergeReviewError
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/tickets", () => ({
  recordTicketEvent: mocks.recordTicketEvent
}));

import { PATCH } from "@/app/api/merge-reviews/[reviewId]/route";

const REVIEW_ID = "55555555-5555-5555-5555-555555555555";

function buildUser(roleName: "agent" | "viewer") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

function buildTask(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: REVIEW_ID,
    status: "pending",
    proposal_type: "ticket",
    ticket_id: "11111111-1111-1111-1111-111111111111",
    source_ticket_id: "11111111-1111-1111-1111-111111111111",
    target_ticket_id: "22222222-2222-2222-2222-222222222222",
    source_customer_id: null,
    target_customer_id: null,
    reason: "Duplicate",
    confidence: 0.97,
    metadata: null,
    failure_reason: null,
    proposed_by_agent_id: "agent-1",
    proposed_by_user_id: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    applied_at: null,
    created_at: "2026-02-14T00:00:00.000Z",
    updated_at: "2026-02-14T00:00:00.000Z",
    ...overrides
  };
}

async function patchDecision(payload: Record<string, unknown>) {
  const request = new Request(`http://localhost/api/merge-reviews/${REVIEW_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await PATCH(request, {
    params: Promise.resolve({ reviewId: REVIEW_ID })
  });
  const body = await response.json();
  return { response, body };
}

describe("PATCH /api/merge-reviews/[reviewId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.getMergeReviewTaskForUser.mockResolvedValue(buildTask());
    mocks.resolveMergeReviewTask.mockResolvedValue({
      task: buildTask({ status: "applied", applied_at: "2026-02-14T10:00:00.000Z" }),
      mergeResult: { sourceTicketId: "source", targetTicketId: "target" }
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.recordTicketEvent.mockResolvedValue(undefined);
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await patchDecision({ decision: "approve" });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 403 for viewer role", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("viewer"));

    const { response, body } = await patchDecision({ decision: "approve" });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns 404 when review is not visible to user", async () => {
    mocks.getMergeReviewTaskForUser.mockResolvedValue(null);

    const { response, body } = await patchDecision({ decision: "approve" });

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: "Merge review task not found" });
    expect(mocks.resolveMergeReviewTask).not.toHaveBeenCalled();
  });

  it("applies approve decision and writes audit + ticket event", async () => {
    const { response, body } = await patchDecision({
      decision: "approve",
      note: "Confirmed duplicate escalation"
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      mergeResult: { sourceTicketId: "source", targetTicketId: "target" }
    });
    expect(mocks.resolveMergeReviewTask).toHaveBeenCalledWith({
      reviewId: REVIEW_ID,
      decision: "approve",
      actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      note: "Confirmed duplicate escalation"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "merge_review_approved",
        entityId: REVIEW_ID
      })
    );
    expect(mocks.recordTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "11111111-1111-1111-1111-111111111111",
        eventType: "merge_review_applied"
      })
    );
  });

  it("maps not_pending error to HTTP 409", async () => {
    mocks.resolveMergeReviewTask.mockRejectedValue(
      new mocks.MergeReviewError("not_pending", "Merge review task is no longer pending.")
    );

    const { response, body } = await patchDecision({ decision: "approve" });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "not_pending",
      error: "Merge review task is no longer pending."
    });
  });
});

