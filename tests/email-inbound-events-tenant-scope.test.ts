import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

import {
  lockFailedInboundEvents,
  markInboundFailed,
  markInboundProcessed
} from "@/server/email/inbound-events";

describe("inbound email event tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
  });

  it("keeps inbound event SQL tenant-scoped", () => {
    const files = [
      "src/server/email/inbound-events.ts",
      "src/server/email/inbound-retry.ts"
    ];

    for (const relativePath of files) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
      const result = scanFileContent(relativePath, source);

      expect(result.findings).toEqual([]);
    }
  });

  it("scopes processed state transitions to the stored event workspace", async () => {
    await markInboundProcessed({
      id: "inbound-1",
      messageId: "message-1",
      ticketId: "ticket-1",
      tenantKey: "tenant-email",
      workspaceKey: "workspace-email"
    });

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND workspace_key = $5"),
      ["inbound-1", "message-1", "ticket-1", "tenant-email", "workspace-email"]
    );
  });

  it("scopes failed state transitions to the stored event workspace", async () => {
    await markInboundFailed({
      id: "inbound-1",
      error: "provider timeout",
      tenantKey: "tenant-email",
      workspaceKey: "workspace-email"
    });

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND workspace_key = $4"),
      ["inbound-1", "provider timeout", "tenant-email", "workspace-email"]
    );
  });

  it("locks failed events inside one tenant workspace", async () => {
    await lockFailedInboundEvents(25, {
      tenantKey: "tenant-email",
      workspaceKey: "workspace-email"
    });

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND workspace_key = $3"),
      [25, "tenant-email", "workspace-email"]
    );
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(3, "COMMIT");
    expect(mocks.clientRelease).toHaveBeenCalled();
  });
});
