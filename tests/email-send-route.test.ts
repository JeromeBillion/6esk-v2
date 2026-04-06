import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canManageTickets: vi.fn(),
  isLeadAdmin: vi.fn(),
  isWorkspaceModuleEnabled: vi.fn(),
  findMailbox: vi.fn(),
  getOrCreateMailbox: vi.fn(),
  hasMailboxAccess: vi.fn(),
  getMessageById: vi.fn(),
  dbQuery: vi.fn(),
  putObject: vi.fn(),
  recordModuleUsageEvent: vi.fn(),
  enqueueEmailOutboxEvent: vi.fn(),
  isMailDraftRecord: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  canManageTickets: mocks.canManageTickets,
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/workspace-modules", () => ({
  isWorkspaceModuleEnabled: mocks.isWorkspaceModuleEnabled
}));

vi.mock("@/server/email/mailbox", () => ({
  findMailbox: mocks.findMailbox,
  getOrCreateMailbox: mocks.getOrCreateMailbox
}));

vi.mock("@/server/messages", () => ({
  hasMailboxAccess: mocks.hasMailboxAccess,
  getMessageById: mocks.getMessageById
}));

vi.mock("@/server/email/drafts", () => ({
  isMailDraftRecord: mocks.isMailDraftRecord
}));

vi.mock("@/server/email/outbox", () => ({
  enqueueEmailOutboxEvent: mocks.enqueueEmailOutboxEvent
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: mocks.recordModuleUsageEvent
}));

function buildUser() {
  return {
    id: "user-1",
    email: "jerome.choma@6ex.co.za",
    display_name: "Jerome",
    role_id: "role-1",
    role_name: "lead_admin"
  };
}

describe("POST /api/email/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.canManageTickets.mockReturnValue(true);
    mocks.isLeadAdmin.mockReturnValue(false);
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);
    mocks.findMailbox.mockResolvedValue({
      id: "mailbox-1",
      type: "personal",
      address: "jerome.choma@6ex.co.za",
      owner_user_id: "user-1"
    });
    mocks.getOrCreateMailbox.mockResolvedValue(null);
    mocks.hasMailboxAccess.mockResolvedValue(true);
    mocks.getMessageById.mockResolvedValue(null);
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.putObject.mockResolvedValue("messages/local/body.txt");
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
    mocks.enqueueEmailOutboxEvent.mockResolvedValue("evt-1");
    mocks.isMailDraftRecord.mockReturnValue(true);
  });

  afterEach(() => {
  });

  it("queues threaded inbox replies with stable local thread metadata", async () => {
    const { POST } = await import("@/app/api/email/send/route");
    const response = await POST(
      new Request("http://localhost/api/email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: "jerome.choma@6ex.co.za",
          to: ["customer@example.com"],
          subject: "Re: Need help",
          text: "Thanks, working on it.",
          threadId: "<root@example.com>",
          inReplyTo: "<parent@example.com>",
          references: ["<root@example.com>"]
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "queued" });

    const [insertSql, insertValues] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(insertSql).toContain("metadata");
    expect(insertSql).toContain("in_reply_to");
    expect(insertSql).toContain("reference_ids");
    expect(insertValues[2]).toMatch(/^<.+@6ex\.co\.za>$/);
    expect(insertValues[3]).toBe("<root@example.com>");
    expect(insertValues[4]).toBe("<parent@example.com>");
    expect(insertValues[5]).toEqual(["<root@example.com>", "<parent@example.com>"]);
    expect(mocks.enqueueEmailOutboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageRecordId: insertValues[0],
        from: "jerome.choma@6ex.co.za",
        to: ["customer@example.com"],
        subject: "Re: Need help"
      })
    );
  });

  it("creates a queued local thread for non-reply compose sends", async () => {
    const { POST } = await import("@/app/api/email/send/route");
    const response = await POST(
      new Request("http://localhost/api/email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: "jerome.choma@6ex.co.za",
          to: ["customer@example.com"],
          subject: "Fresh thread",
          text: "Hello there."
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "queued" });

    const [, insertValues] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(insertValues[2]).toMatch(/^<.+@6ex\.co\.za>$/);
    expect(insertValues[3]).toBe(insertValues[2]);
    expect(insertValues[4]).toBeNull();
    expect(insertValues[5]).toBeNull();
    expect(mocks.enqueueEmailOutboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageRecordId: insertValues[0],
        subject: "Fresh thread"
      })
    );
  });

  it("transitions the source draft into queued outbox state", async () => {
    mocks.getMessageById.mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      mailbox_id: "mailbox-1",
      direction: "outbound",
      sent_at: null,
      metadata: { mail_state: "draft" }
    });

    const { POST } = await import("@/app/api/email/send/route");
    const response = await POST(
      new Request("http://localhost/api/email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: "jerome.choma@6ex.co.za",
          to: ["customer@example.com"],
          subject: "Draft send",
          text: "Sending a saved draft.",
          draftId: "11111111-1111-1111-1111-111111111111"
        })
      })
    );

    expect(response.status).toBe(200);
    const [updateSql, updateValues] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(updateSql).toContain("mail_state', 'queued'");
    expect(updateValues[10]).toBe("11111111-1111-1111-1111-111111111111");
    expect(mocks.enqueueEmailOutboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageRecordId: "11111111-1111-1111-1111-111111111111",
        subject: "Draft send"
      })
    );
  });
});
