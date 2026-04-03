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
      role_name: "lead_admin"
    };

    await listTicketsForUser(user, {});

    const [sql] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("LEFT JOIN mailboxes mb ON mb.id = t.mailbox_id");
    expect(sql).toContain("(t.mailbox_id IS NULL OR mb.type = 'platform')");
  });
});
