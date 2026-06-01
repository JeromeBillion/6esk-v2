import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { getOrCreateMailbox } from "@/server/email/mailbox";
import { upsertExternalUserLink } from "@/server/integrations/external-user-links";
import { createTicket, getTicketById } from "@/server/tickets";

describe("core tenant isolation SQL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("stamps tenant and workspace when creating tickets", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: "ticket-1" }] });

    await createTicket({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      mailboxId: "mailbox-1",
      requesterEmail: "customer@example.com",
      subject: "Help"
    });

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("tenant_key, workspace_key");
    expect(values.slice(0, 2)).toEqual(["tenant-a", "workspace-a"]);
  });

  it("requires tenant scope when fetching tickets by id", async () => {
    await getTicketById("ticket-1", { tenantKey: "tenant-a" });

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("AND t.tenant_key = $2");
    expect(values).toEqual(["ticket-1", "tenant-a"]);
  });

  it("uses tenant-scoped mailbox upserts", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "mailbox-1",
            tenant_key: "tenant-a",
            workspace_key: "workspace-a",
            type: "platform",
            address: "support@example.com",
            owner_user_id: null
          }
        ]
      });

    await getOrCreateMailbox("support@example.com", "support@example.com", {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });

    const [sql, values] = mocks.dbQuery.mock.calls[1] ?? [];
    expect(sql).toContain("ON CONFLICT (tenant_key, address)");
    expect(values.slice(0, 2)).toEqual(["tenant-a", "workspace-a"]);
  });

  it("uses tenant-scoped external identity upserts", async () => {
    await upsertExternalUserLink({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      externalSystem: "prediction-market-mvp",
      profile: { id: "user-1", email: "user@example.com" },
      ticketId: "ticket-1",
      channel: "email"
    });

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("ON CONFLICT (tenant_key, external_system, external_user_id)");
    expect(values.slice(0, 4)).toEqual([
      "tenant-a",
      "workspace-a",
      "prediction-market-mvp",
      "user-1"
    ]);
  });
});
