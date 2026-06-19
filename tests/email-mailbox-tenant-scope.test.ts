import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { getOrCreateMailbox, resolveInboundMailbox } from "@/server/email/mailbox";

describe("email mailbox tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("rejects platform mailbox creation without tenant scope", async () => {
    await expect(getOrCreateMailbox("support@example.com", "support@example.com")).rejects.toThrow(
      "Create mailbox requires tenantId"
    );

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      "SELECT id, tenant_id FROM users WHERE lower(email) = $1 LIMIT 1",
      ["support@example.com"]
    );
  });

  it("creates platform mailboxes only under the supplied tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "mailbox-1",
            tenant_id: TENANT_ID,
            type: "platform",
            address: "support@example.com",
            owner_user_id: null
          }
        ]
      });

    const mailbox = await getOrCreateMailbox("support@example.com", "support@example.com", TENANT_ID);

    expect(mailbox).toMatchObject({ id: "mailbox-1", tenant_id: TENANT_ID });
    const [, insertValues] = mocks.dbQuery.mock.calls[1] ?? [];
    expect(insertValues[0]).toBe(TENANT_ID);
  });

  it("uses an owner user's tenant for personal mailbox creation", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "user-1", tenant_id: TENANT_ID }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "mailbox-1",
            tenant_id: TENANT_ID,
            type: "personal",
            address: "agent@example.com",
            owner_user_id: "user-1"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const mailbox = await getOrCreateMailbox("agent@example.com", "support@example.com");

    expect(mailbox).toMatchObject({ id: "mailbox-1", tenant_id: TENANT_ID });
    const [, insertValues] = mocks.dbQuery.mock.calls[1] ?? [];
    expect(insertValues[0]).toBe(TENANT_ID);
    expect(insertValues[3]).toBe("user-1");
  });

  it("resolves support-address inbound only from an existing mailbox", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "mailbox-1",
          tenant_id: TENANT_ID,
          type: "platform",
          address: "support@example.com",
          owner_user_id: null
        }
      ]
    });

    const mailbox = await resolveInboundMailbox("support@example.com", "support@example.com");

    expect(mailbox).toMatchObject({ id: "mailbox-1", tenant_id: TENANT_ID });
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      "SELECT id, tenant_id, type, address, owner_user_id FROM mailboxes WHERE address = $1",
      ["support@example.com"]
    );
  });
});
