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

import {
  createDraft,
  getDraftById,
  listDraftsForTicket,
  listPendingDraftsForUser,
  updateDraftContent,
  updateDraftStatus
} from "@/server/agents/drafts";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "agent@example.com",
    display_name: "Agent",
    role_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

describe("agent draft service tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("does not read draft records without tenant scope", async () => {
    await expect(getDraftById({ draftId: "draft-1", ticketId: "ticket-1", tenantId: "" })).resolves.toBeNull();
    await expect(listDraftsForTicket("ticket-1", "")).resolves.toEqual([]);
    await expect(listPendingDraftsForUser(buildUser(null))).resolves.toEqual([]);

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("does not update draft records without tenant scope", async () => {
    await expect(
      updateDraftStatus({
        draftId: "draft-1",
        ticketId: "ticket-1",
        status: "used",
        tenantId: ""
      })
    ).resolves.toBeNull();
    await expect(
      updateDraftContent({
        draftId: "draft-1",
        ticketId: "ticket-1",
        subject: "Subject",
        bodyText: "Text",
        bodyHtml: null,
        tenantId: ""
      })
    ).resolves.toBeNull();

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects draft creation without tenant scope", async () => {
    await expect(
      createDraft({
        tenantId: "",
        integrationId: "agent-1",
        ticketId: "ticket-1",
        bodyText: "Draft"
      })
    ).rejects.toThrow("Create agent draft requires tenantId");

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("lists pending drafts only inside the session tenant", async () => {
    await listPendingDraftsForUser(buildUser(), { channel: "whatsapp" });

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("d.tenant_id = $1");
    expect(sql).toContain("t.tenant_id = d.tenant_id");
    expect(sql).toContain("channel_msg.tenant_id = d.tenant_id");
    expect(values).toEqual([TENANT_ID, "whatsapp", "whatsapp:%"]);
  });
});
