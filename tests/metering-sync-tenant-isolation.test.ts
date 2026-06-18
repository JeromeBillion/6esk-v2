import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  getTenantById: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/tenant/lifecycle", () => ({
  getTenantById: mocks.getTenantById
}));

import { syncPendingMeteringEvents } from "@/server/billing/metering-sync";

describe("metering sync tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.clientRelease.mockResolvedValue(undefined);
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
    mocks.getTenantById.mockResolvedValue({ id: TENANT_ID, status: "active" });
  });

  it("rejects sync without tenant scope", async () => {
    await expect(syncPendingMeteringEvents({ limit: 10, tenantId: "" })).rejects.toThrow(
      "Sync pending metering events requires tenantId"
    );

    expect(mocks.dbConnect).not.toHaveBeenCalled();
  });

  it("scopes pending-event locking to the requested tenant", async () => {
    await syncPendingMeteringEvents({ limit: 10, tenantId: TENANT_ID });

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND tenant_id = $2"),
      [10, TENANT_ID]
    );
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(3, "COMMIT");
  });

  it("scopes event status updates to the requested tenant", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [
          {
            id: "usage-event-1",
            tenant_id: TENANT_ID,
            workspace_key: "primary",
            module_key: "email",
            usage_kind: "outbound_email",
            quantity: 1,
            created_at: new Date("2026-06-18T08:00:00.000Z")
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await syncPendingMeteringEvents({ limit: 5, tenantId: TENANT_ID });

    expect(mocks.getTenantById).toHaveBeenCalledWith(TENANT_ID);
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("WHERE id = $1 AND tenant_id = $2"),
      ["usage-event-1", TENANT_ID]
    );
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(4, "COMMIT");
  });
});
