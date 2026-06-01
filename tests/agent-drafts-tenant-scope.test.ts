import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { createDraft } from "@/server/agents/drafts";

describe("agent drafts tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({
      rows: [
        {
          id: "draft-1",
          tenant_key: "tenant-agent",
          workspace_key: "workspace-agent",
          integration_id: "integration-1",
          ticket_id: "ticket-1",
          subject: "Reply",
          body_text: "Draft body",
          body_html: null,
          confidence: 0.9,
          metadata: null,
          status: "pending",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z"
        }
      ]
    });
  });

  it("keeps agent draft SQL tenant-scoped", () => {
    const relativePath = "src/server/agents/drafts.ts";
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const result = scanFileContent(relativePath, source);

    expect(result.findings).toEqual([]);
  });

  it("creates drafts by deriving stored scope from a matching ticket and integration", async () => {
    const draft = await createDraft({
      integrationId: "integration-1",
      ticketId: "ticket-1",
      tenantKey: "tenant-agent",
      workspaceKey: "workspace-agent",
      subject: "Reply",
      bodyText: "Draft body",
      bodyHtml: null,
      confidence: 0.9,
      metadata: null
    });

    expect(draft).toMatchObject({
      id: "draft-1",
      tenant_key: "tenant-agent",
      workspace_key: "workspace-agent"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_drafts"),
      [
        "integration-1",
        "ticket-1",
        "Reply",
        "Draft body",
        null,
        0.9,
        null,
        "tenant-agent",
        "workspace-agent"
      ]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT ticket.tenant_key, ticket.workspace_key"),
      expect.any(Array)
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND integration.tenant_key = ticket.tenant_key"),
      expect.any(Array)
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND ticket.workspace_key = $9"),
      expect.any(Array)
    );
  });
});
