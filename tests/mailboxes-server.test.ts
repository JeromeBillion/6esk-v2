import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { listInboxMailboxesForUser } from "@/server/mailboxes";

describe("listInboxMailboxesForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({
      rows: [{ id: "mailbox-1", address: "jerome.choma@6ex.co.za", type: "personal" }]
    });
  });

  it("returns only personal mailboxes for the signed-in user", async () => {
    const user = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "jerome.choma@6ex.co.za",
      display_name: "Jerome",
      role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      role_name: "lead_admin"
    };

    const result = await listInboxMailboxesForUser(user);

    expect(result).toEqual([{ id: "mailbox-1", address: "jerome.choma@6ex.co.za", type: "personal" }]);
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("JOIN mailbox_memberships mm ON mm.mailbox_id = m.id");
    expect(sql).toContain("m.type = 'personal'");
    expect(values).toEqual([user.id]);
  });
});
