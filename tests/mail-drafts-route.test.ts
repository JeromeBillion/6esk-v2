import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listInboxMailboxesForUser: vi.fn(),
  upsertMailDraft: vi.fn(),
  deleteMailDraft: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/mailboxes", () => ({
  listInboxMailboxesForUser: mocks.listInboxMailboxesForUser
}));

vi.mock("@/server/email/drafts", () => ({
  upsertMailDraft: mocks.upsertMailDraft,
  deleteMailDraft: mocks.deleteMailDraft
}));

describe("mail draft routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1",
      email: "jerome.choma@6ex.co.za"
    });
    mocks.listInboxMailboxesForUser.mockResolvedValue([
      {
        id: "mailbox-1",
        address: "jerome.choma@6ex.co.za",
        type: "personal"
      }
    ]);
    mocks.upsertMailDraft.mockResolvedValue({
      id: "draft-1",
      direction: "outbound",
      channel: "email",
      from_email: "jerome.choma@6ex.co.za",
      to_emails: ["customer@example.com"],
      subject: "Draft subject",
      preview_text: "Draft body",
      received_at: null,
      sent_at: null,
      is_read: true,
      is_starred: false,
      is_pinned: false,
      is_spam: false,
      spam_reason: null,
      thread_id: null,
      message_id: null,
      created_at: "2026-04-06T10:00:00.000Z",
      has_attachments: false,
      mail_state: "draft",
      sort_at: "2026-04-06T10:00:00.000Z"
    });
    mocks.deleteMailDraft.mockResolvedValue(true);
  });

  it("saves personal mailbox drafts", async () => {
    const { POST } = await import("@/app/api/mailboxes/[mailboxId]/drafts/route");

    const response = await POST(
      new Request("http://localhost/api/mailboxes/mailbox-1/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: ["customer@example.com"],
          subject: "Draft subject",
          text: "Draft body"
        })
      }),
      { params: Promise.resolve({ mailboxId: "mailbox-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.upsertMailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxId: "mailbox-1",
        fromEmail: "jerome.choma@6ex.co.za",
        to: ["customer@example.com"],
        subject: "Draft subject",
        text: "Draft body"
      })
    );
  });

  it("deletes saved drafts", async () => {
    const { DELETE } = await import("@/app/api/mailboxes/[mailboxId]/drafts/[draftId]/route");

    const response = await DELETE(
      new Request("http://localhost/api/mailboxes/mailbox-1/drafts/draft-1", {
        method: "DELETE"
      }),
      { params: Promise.resolve({ mailboxId: "mailbox-1", draftId: "draft-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteMailDraft).toHaveBeenCalledWith("draft-1", "mailbox-1");
  });
});
