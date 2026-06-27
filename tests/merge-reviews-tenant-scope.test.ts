import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";
const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_TICKET_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_TICKET_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  mergeTickets: vi.fn(),
  mergeCustomers: vi.fn(),
  linkTickets: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/merges", () => ({
  MergeError: class MergeError extends Error {
    code = "merge_failed";
  },
  mergeTickets: mocks.mergeTickets,
  mergeCustomers: mocks.mergeCustomers,
  linkTickets: mocks.linkTickets
}));

import {
  createMergeReviewTask,
  getMergeReviewTaskForUser,
  listMergeReviewTasksForUser,
  MergeReviewError,
  resolveMergeReviewTask
} from "@/server/merge-reviews";

function buildUser(roleName: "lead_admin" | "agent", tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: `${roleName}@example.com`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: tenantId
  };
}

function buildTask(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: REVIEW_ID,
    tenant_id: TENANT_ID,
    status: "pending",
    proposal_type: "ticket",
    ticket_id: TICKET_ID,
    source_ticket_id: SOURCE_TICKET_ID,
    target_ticket_id: TARGET_TICKET_ID,
    source_customer_id: null,
    target_customer_id: null,
    reason: "Duplicate",
    confidence: 0.96,
    metadata: null,
    failure_reason: null,
    proposed_by_agent_id: null,
    proposed_by_user_id: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    applied_at: null,
    created_at: "2026-02-14T00:00:00.000Z",
    updated_at: "2026-02-14T00:00:00.000Z",
    ...overrides
  };
}

describe("merge review task tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.mergeTickets.mockResolvedValue({ sourceTicketId: SOURCE_TICKET_ID, targetTicketId: TARGET_TICKET_ID });
  });

  it("returns no task when the session has no tenant scope", async () => {
    const task = await getMergeReviewTaskForUser(buildUser("lead_admin", null), REVIEW_ID);

    expect(task).toBeNull();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("fetches visible tasks by id and tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [buildTask()] });

    const task = await getMergeReviewTaskForUser(buildUser("lead_admin"), REVIEW_ID);

    expect(task).toMatchObject({ id: REVIEW_ID, tenant_id: TENANT_ID });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND tenant_id = $2"),
      [REVIEW_ID, TENANT_ID]
    );
  });

  it("lists merge reviews under the user's tenant and tenant-pins joins", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    await listMergeReviewTasksForUser(buildUser("agent"), {
      status: "pending",
      search: "duplicate",
      limit: 25
    });

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("mrt.tenant_id = $1");
    expect(sql).toContain("access_t.tenant_id = mrt.tenant_id");
    expect(sql).toContain("source_ticket.tenant_id = mrt.tenant_id");
    expect(sql).toContain("source_msg.tenant_id = mrt.tenant_id");
    expect(values).toEqual([TENANT_ID, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "pending", "%duplicate%", 25]);
  });

  it("rejects creation without tenant scope before validation queries", async () => {
    await expect(
      createMergeReviewTask({
        tenantId: "",
        proposalType: "ticket",
        sourceTicketId: SOURCE_TICKET_ID,
        targetTicketId: TARGET_TICKET_ID
      })
    ).rejects.toThrow(MergeReviewError);

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("validates ticket references and inserts tasks under tenant scope", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [buildTask()] });

    await createMergeReviewTask({
      tenantId: TENANT_ID,
      proposalType: "ticket",
      ticketId: TICKET_ID,
      sourceTicketId: SOURCE_TICKET_ID,
      targetTicketId: TARGET_TICKET_ID,
      reason: "Duplicate"
    });

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("FROM tickets"),
      [[TICKET_ID, SOURCE_TICKET_ID, TARGET_TICKET_ID], TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO merge_review_tasks"),
      expect.arrayContaining([TENANT_ID, "ticket"])
    );
  });

  it("resolves decisions with tenant-scoped updates", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [buildTask()] })
      .mockResolvedValueOnce({ rows: [{ count: 3 }] })
      .mockResolvedValueOnce({ rows: [buildTask({ status: "approved" })] })
      .mockResolvedValueOnce({ rows: [buildTask({ status: "applied" })] });

    await resolveMergeReviewTask({
      tenantId: TENANT_ID,
      reviewId: REVIEW_ID,
      decision: "approve",
      actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    });

    expect(mocks.dbQuery.mock.calls[0]?.[1]).toEqual([REVIEW_ID, TENANT_ID]);
    expect(mocks.dbQuery.mock.calls[1]?.[0]).toContain("FROM tickets");
    expect(mocks.dbQuery.mock.calls[1]?.[1]).toEqual([
      [TICKET_ID, SOURCE_TICKET_ID, TARGET_TICKET_ID],
      TENANT_ID
    ]);
    expect(mocks.dbQuery.mock.calls[2]?.[0]).toContain("AND tenant_id = $3");
    expect(mocks.dbQuery.mock.calls[2]?.[1]).toEqual([
      REVIEW_ID,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      TENANT_ID
    ]);
    expect(mocks.dbQuery.mock.calls[3]?.[0]).toContain("AND tenant_id = $2");
    expect(mocks.dbQuery.mock.calls[3]?.[1]).toEqual([REVIEW_ID, TENANT_ID]);
  });

  it("passes tenant scope into customer merge side effects", async () => {
    const sourceCustomerId = "55555555-5555-4555-8555-555555555555";
    const targetCustomerId = "66666666-6666-4666-8666-666666666666";
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          buildTask({
            proposal_type: "customer",
            source_ticket_id: null,
            target_ticket_id: null,
            source_customer_id: sourceCustomerId,
            target_customer_id: targetCustomerId
          })
        ]
      })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          buildTask({
            status: "approved",
            proposal_type: "customer",
            source_ticket_id: null,
            target_ticket_id: null,
            source_customer_id: sourceCustomerId,
            target_customer_id: targetCustomerId
          })
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          buildTask({
            status: "applied",
            proposal_type: "customer",
            source_ticket_id: null,
            target_ticket_id: null,
            source_customer_id: sourceCustomerId,
            target_customer_id: targetCustomerId
          })
        ]
      });

    mocks.mergeCustomers.mockResolvedValueOnce({ sourceCustomerId, targetCustomerId });

    await resolveMergeReviewTask({
      tenantId: TENANT_ID,
      reviewId: REVIEW_ID,
      decision: "approve",
      actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    });

    expect(mocks.mergeCustomers).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      sourceCustomerId,
      targetCustomerId,
      actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      reason: "Duplicate"
    });
  });

  it("rejects approval before side effects when stored references are outside the tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [buildTask()] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    await expect(
      resolveMergeReviewTask({
        tenantId: TENANT_ID,
        reviewId: REVIEW_ID,
        decision: "approve",
        actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      })
    ).rejects.toThrow("Merge review ticket references must belong to the same tenant.");

    expect(mocks.mergeTickets).not.toHaveBeenCalled();
    expect(mocks.dbQuery).toHaveBeenCalledTimes(2);
  });
});
