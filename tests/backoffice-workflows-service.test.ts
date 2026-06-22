import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  recordAuditLogWithClient: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLogWithClient: mocks.recordAuditLogWithClient
}));

import {
  BackofficeWorkflowError,
  createBackofficeCase,
  upsertTenantBackofficeProfile
} from "@/server/backoffice/workflows";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const caseRow = {
  id: CASE_ID,
  tenant_id: TENANT_ID,
  tenant_slug: "acme",
  tenant_display_name: "Acme",
  tenant_status: "active",
  case_type: "implementation",
  status: "open",
  priority: "p1",
  title: "Launch readiness",
  summary: null,
  owner_user_id: USER_ID,
  owner_email: "ops@6esk.com",
  due_at: null,
  external_reference: null,
  metadata: {},
  created_at: "2026-06-22T00:00:00.000Z",
  updated_at: "2026-06-22T00:00:00.000Z",
  closed_at: null
};

describe("backoffice workflow service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
    mocks.clientQuery.mockResolvedValue({ rows: [] });
    mocks.recordAuditLogWithClient.mockResolvedValue(undefined);
  });

  it("rejects customer-tenant users as backoffice owners", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      upsertTenantBackofficeProfile({
        tenantId: TENANT_ID,
        accountOwnerUserId: USER_ID
      })
    ).rejects.toMatchObject({
      code: "INTERNAL_OWNER_NOT_FOUND",
      status: 400
    } satisfies Partial<BackofficeWorkflowError>);

    expect(mocks.dbConnect).not.toHaveBeenCalled();
    expect(mocks.recordAuditLogWithClient).not.toHaveBeenCalled();
  });

  it("creates tenant-linked cases only after validating an internal owner", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: USER_ID }] });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [caseRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const backofficeCase = await createBackofficeCase({
      tenantId: TENANT_ID,
      caseType: "implementation",
      title: "Launch readiness",
      priority: "p1",
      ownerUserId: USER_ID,
      actorUserId: USER_ID
    });

    expect(backofficeCase.ownerUserId).toBe(USER_ID);
    expect(backofficeCase.ownerEmail).toBe("ops@6esk.com");
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("r.name = ANY"),
      [USER_ID, ["internal_admin", "internal_support"]]
    );
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO backoffice_cases"),
      expect.arrayContaining([TENANT_ID, "implementation", "Launch readiness", null, "p1", USER_ID])
    );
    expect(mocks.recordAuditLogWithClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "backoffice_case_created",
        entityType: "backoffice_case",
        entityId: CASE_ID
      })
    );
  });

  it("rolls back case creation when audit evidence cannot be written", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: USER_ID }] });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [caseRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.recordAuditLogWithClient.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      createBackofficeCase({
        tenantId: TENANT_ID,
        caseType: "implementation",
        title: "Launch readiness",
        priority: "p1",
        ownerUserId: USER_ID,
        actorUserId: USER_ID
      })
    ).rejects.toThrow("audit unavailable");

    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.clientQuery).not.toHaveBeenCalledWith("COMMIT");
  });
});
