import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  findExternalUserLinkByIdentity,
  upsertExternalUserLink
} from "@/server/integrations/external-user-links";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

describe("external user links tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("rejects cache lookups without tenant scope before querying", async () => {
    await expect(
      findExternalUserLinkByIdentity({
        tenantId: "",
        externalSystem: "external-profile",
        email: "customer@example.com"
      })
    ).rejects.toThrow("tenantId is required");

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("filters cache lookups by tenant before matching identity", async () => {
    await findExternalUserLinkByIdentity({
      tenantId: TENANT_ID,
      externalSystem: "external-profile",
      email: "Customer@Example.com",
      phone: "+27 71 000 0001"
    });

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("FROM external_user_links");
    expect(sql).toContain("WHERE tenant_id = $1");
    expect(sql).toContain("AND external_system = $2");
    expect(values).toEqual([
      TENANT_ID,
      "external-profile",
      "customer@example.com",
      "+27710000001"
    ]);
  });

  it("rejects cache writes without tenant scope before querying", async () => {
    await expect(
      upsertExternalUserLink({
        tenantId: null,
        externalSystem: "external-profile",
        profile: { id: "user-1", email: "customer@example.com" },
        ticketId: "ticket-1",
        channel: "email"
      })
    ).rejects.toThrow("tenantId is required");

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("writes external identities behind a tenant-scoped uniqueness boundary", async () => {
    await upsertExternalUserLink({
      tenantId: TENANT_ID,
      externalSystem: "external-profile",
      profile: { id: "user-1", email: "customer@example.com" },
      matchedBy: "email",
      ticketId: "ticket-1",
      channel: "email"
    });

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("INSERT INTO external_user_links");
    expect(sql).toContain("tenant_id");
    expect(sql).toContain("ON CONFLICT (tenant_id, external_system, external_user_id)");
    expect(values?.slice(0, 3)).toEqual([TENANT_ID, "external-profile", "user-1"]);
  });
});
