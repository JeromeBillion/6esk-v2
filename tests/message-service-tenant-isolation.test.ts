import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";
const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";
const MAILBOX_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  getAttachmentsForMessage,
  getMessageById,
  getTicketAssignment,
  hasMailboxAccess
} from "@/server/messages";

describe("message service tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("requires tenant scope for message reads", async () => {
    await getMessageById(MESSAGE_ID, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND tenant_id = $2"),
      [MESSAGE_ID, TENANT_ID]
    );
  });

  it("requires tenant scope for message attachment reads", async () => {
    await getAttachmentsForMessage(MESSAGE_ID, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND tenant_id = $2"),
      [MESSAGE_ID, TENANT_ID]
    );
  });

  it("requires tenant scope for ticket assignment checks", async () => {
    await getTicketAssignment(TICKET_ID, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND tenant_id = $2"),
      [TICKET_ID, TENANT_ID]
    );
  });

  it("requires tenant scope for mailbox membership checks", async () => {
    await hasMailboxAccess(USER_ID, MAILBOX_ID, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND m.tenant_id = $3"),
      [MAILBOX_ID, USER_ID, TENANT_ID]
    );
  });
});
