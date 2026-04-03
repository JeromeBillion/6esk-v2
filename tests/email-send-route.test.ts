import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canManageTickets: vi.fn(),
  isLeadAdmin: vi.fn(),
  isWorkspaceModuleEnabled: vi.fn(),
  findMailbox: vi.fn(),
  getOrCreateMailbox: vi.fn(),
  hasMailboxAccess: vi.fn(),
  dbQuery: vi.fn(),
  putObject: vi.fn(),
  recordModuleUsageEvent: vi.fn()
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
  hasMailboxAccess: mocks.hasMailboxAccess
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
    vi.stubGlobal("fetch", vi.fn());
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
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.putObject.mockResolvedValue("messages/local/body.txt");
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends threaded inbox replies with stable local thread metadata", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-msg-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

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
    await expect(response.json()).resolves.toMatchObject({ status: "sent" });

    const [, resendInit] = fetchMock.mock.calls[0] ?? [];
    const resendPayload = JSON.parse(String((resendInit as RequestInit).body));
    expect(resendPayload.headers).toEqual({
      "In-Reply-To": "<parent@example.com>",
      References: "<root@example.com> <parent@example.com>"
    });

    const [insertSql, insertValues] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(insertSql).toContain("in_reply_to");
    expect(insertSql).toContain("reference_ids");
    expect(insertValues[2]).toBe("provider-msg-1");
    expect(insertValues[3]).toBe("<root@example.com>");
    expect(insertValues[4]).toBe("<parent@example.com>");
    expect(insertValues[5]).toEqual(["<root@example.com>", "<parent@example.com>"]);
  });

  it("creates a new local thread for non-reply compose sends", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-msg-2" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

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
    const [, resendInit] = fetchMock.mock.calls[0] ?? [];
    const resendPayload = JSON.parse(String((resendInit as RequestInit).body));
    expect(resendPayload.headers).toEqual({});

    const [, insertValues] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(insertValues[2]).toBe("provider-msg-2");
    expect(insertValues[3]).toBe("provider-msg-2");
    expect(insertValues[4]).toBeNull();
    expect(insertValues[5]).toBeNull();
  });
});
