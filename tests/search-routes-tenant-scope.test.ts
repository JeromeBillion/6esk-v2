import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canManageTickets: vi.fn(),
  isLeadAdmin: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  canManageTickets: mocks.canManageTickets,
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { GET as getCustomersSearch } from "@/app/api/customers/search/route";
import { GET as getTicketsSearch } from "@/app/api/tickets/search/route";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: USER_ID,
    email: "agent@example.com",
    display_name: "Agent",
    role_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

describe("CRM search route tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.canManageTickets.mockReturnValue(true);
    mocks.isLeadAdmin.mockReturnValue(true);
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("rejects tenantless sessions before customer or ticket search", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const customers = await getCustomersSearch(
      new Request("http://localhost/api/customers/search?q=sarah")
    );
    const tickets = await getTicketsSearch(
      new Request("http://localhost/api/tickets/search?q=sarah")
    );

    expect(customers.status).toBe(403);
    expect(tickets.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("searches customers only inside the session tenant", async () => {
    await getCustomersSearch(new Request("http://localhost/api/customers/search?q=sarah&limit=30"));

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    const [sql, values] = mocks.dbQuery.mock.calls[0];
    expect(sql).toContain("WHERE c.tenant_id = $2");
    expect(sql).toContain("ci.tenant_id = c.tenant_id");
    expect(sql).toContain("t.tenant_id = c.tenant_id");
    expect(sql).toContain("ciq.tenant_id = c.tenant_id");
    expect(values).toEqual(["%sarah%", TENANT_ID, 30]);
  });

  it("searches tickets and message channel probes only inside the session tenant", async () => {
    await getTicketsSearch(new Request("http://localhost/api/tickets/search?q=refund&limit=30"));

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    const [sql, values] = mocks.dbQuery.mock.calls[0];
    expect(sql).toContain("t.tenant_id = $1");
    expect(sql).toContain("wm.tenant_id = t.tenant_id");
    expect(sql).toContain("vm.tenant_id = t.tenant_id");
    expect(sql).toContain("m.tenant_id = t.tenant_id");
    expect(values).toEqual([TENANT_ID, "%refund%", 30]);
  });

  it("keeps assigned-agent search tenant-scoped for non-admin agents", async () => {
    mocks.isLeadAdmin.mockReturnValue(false);

    await getTicketsSearch(new Request("http://localhost/api/tickets/search?q=refund&limit=10"));

    const [sql, values] = mocks.dbQuery.mock.calls[0];
    expect(sql).toContain("t.tenant_id = $1");
    expect(sql).toContain("t.assigned_user_id = $3");
    expect(values).toEqual([TENANT_ID, "%refund%", USER_ID, 10]);
  });
});
