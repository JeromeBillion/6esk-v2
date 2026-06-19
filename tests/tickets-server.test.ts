import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { listTicketsForUser } from "@/server/tickets";

describe("listTicketsForUser", () => {
  const tenantId = "99999999-9999-4999-8999-999999999999";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("limits support queues to platform mailboxes", async () => {
    const user = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "jerome.choma@6ex.co.za",
      display_name: "Jerome",
      role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      role_name: "lead_admin",
      tenant_id: tenantId
    };

    await listTicketsForUser(user, {});

    const [sql] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("LEFT JOIN mailboxes mb ON mb.id = t.mailbox_id");
    expect(sql).toContain("(t.mailbox_id IS NULL OR mb.type = 'platform')");
    expect(sql).toContain("t.tenant_id = $1");
    expect(mocks.dbQuery.mock.calls[0]?.[1]).toEqual([tenantId]);
  });

  it("fails closed without tenant scope", async () => {
    const user = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "jerome.choma@6ex.co.za",
      display_name: "Jerome",
      role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      role_name: "lead_admin",
      tenant_id: null
    };

    const result = await listTicketsForUser(user, {});

    expect(result).toEqual([]);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
