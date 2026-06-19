import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { getPlatformMailbox, listInboxMailboxesForUser } from "@/server/mailboxes";

describe("listInboxMailboxesForUser", () => {
  const tenantId = "99999999-9999-4999-8999-999999999999";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({
      rows: [
        {
          id: "mailbox-1",
          address: "jerome.choma@6ex.co.za",
          type: "personal",
          provider: "resend",
          delivery_mode: "managed"
        }
      ]
    });
  });

  it("returns only personal mailboxes for the signed-in user", async () => {
    const user = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      email: "jerome.choma@6ex.co.za",
      display_name: "Jerome",
      role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      role_name: "lead_admin",
      tenant_id: tenantId
    };

    const result = await listInboxMailboxesForUser(user);

    expect(result).toEqual([
      {
        id: "mailbox-1",
        address: "jerome.choma@6ex.co.za",
        type: "personal",
        provider: "resend",
        delivery_mode: "managed"
      }
    ]);
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("JOIN mailbox_memberships mm ON mm.mailbox_id = m.id AND mm.tenant_id = m.tenant_id");
    expect(sql).toContain("mm.tenant_id = $2");
    expect(sql).toContain("m.type = 'personal'");
    expect(values).toEqual([user.id, tenantId]);
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

    const result = await listInboxMailboxesForUser(user);

    expect(result).toEqual([]);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});

describe("getPlatformMailbox", () => {
  const tenantId = "99999999-9999-4999-8999-999999999999";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({
      rows: [
        {
          id: "mailbox-platform-1",
          address: "support@example.com",
          type: "platform",
          provider: "resend",
          delivery_mode: "managed"
        }
      ]
    });
  });

  it("fails closed without tenant scope", async () => {
    await expect(getPlatformMailbox("")).resolves.toBeNull();

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("reads platform mailbox only inside the supplied tenant", async () => {
    const result = await getPlatformMailbox(tenantId);

    expect(result).toMatchObject({
      id: "mailbox-platform-1",
      address: "support@example.com",
      type: "platform"
    });
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE type = 'platform'");
    expect(sql).toContain("tenant_id = $1");
    expect(values).toEqual([tenantId]);
  });
});
