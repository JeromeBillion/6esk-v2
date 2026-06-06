import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getObjectBuffer: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/storage/r2", () => ({
  getObjectBuffer: mocks.getObjectBuffer
}));

import { exportTenantDataBundle } from "@/server/tenant-export";

describe("tenant data export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getObjectBuffer.mockResolvedValue({
      buffer: Buffer.from("invoice-pdf-bytes"),
      contentType: "application/pdf"
    });
    mocks.dbQuery.mockImplementation((query: string) => {
      if (query.includes("COUNT(*)") && query.includes("FROM users")) {
        return Promise.resolve({ rows: [{ count: "2" }] });
      }
      if (!query.includes("COUNT(*)") && query.includes("FROM users")) {
        return Promise.resolve({
          rows: [
            {
              row: {
                id: "user-1",
                tenant_key: "tenant-a",
                workspace_key: "workspace-a",
                email: "admin@example.test"
              }
            }
          ]
        });
      }
      if (query.includes("COUNT(*)") && query.includes("FROM attachments")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      if (!query.includes("COUNT(*)") && query.includes("FROM attachments")) {
        return Promise.resolve({
          rows: [
            {
              row: {
                id: "attachment-1",
                tenant_key: "tenant-a",
                workspace_key: "workspace-a",
                filename: "invoice.pdf",
                content_type: "application/pdf",
                size_bytes: 2048,
                r2_key: "tenants/tenant-a/workspaces/workspace-a/messages/message-1/attachments/invoice.pdf"
              }
            }
          ]
        });
      }
      if (query.includes("COUNT(*)")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it("exports only the requested tenant workspace and redacts secrets", async () => {
    const bundle = await exportTenantDataBundle(
      { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      { limitPerSection: 1 }
    );

    expect(bundle).toMatchObject({
      formatVersion: "tenant-export.v1",
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      limitPerSection: 1,
      redaction: {
        secretsRedacted: true,
        redactedColumnsBySection: expect.objectContaining({
          users: ["password_hash"],
          agent_integrations: ["shared_secret"],
          whatsapp_accounts: ["access_token", "verify_token"]
        })
      }
    });
    const users = bundle.sections.find((section) => section.key === "users");
    expect(users).toMatchObject({
      rowCount: 2,
      exportedCount: 1,
      truncated: true,
      rows: [{ id: "user-1", tenant_key: "tenant-a", workspace_key: "workspace-a" }]
    });
    expect(users?.rows[0]).not.toHaveProperty("password_hash");
    expect(bundle.objectStorageManifest).toEqual([
      {
        section: "attachments",
        rowId: "attachment-1",
        field: "r2_key",
        key: "tenants/tenant-a/workspaces/workspace-a/messages/message-1/attachments/invoice.pdf",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        sizeBytes: 2048
      }
    ]);
    expect(bundle.objectStoragePayloadSummary).toEqual({
      requested: false,
      included: 0,
      skipped: 0,
      maxBytesPerObject: 2 * 1024 * 1024
    });
    expect(bundle.objectStoragePayloads).toEqual([]);
    expect(bundle.objectStoragePayloadSkips).toEqual([]);
    expect(mocks.getObjectBuffer).not.toHaveBeenCalled();

    const userRowsQuery = mocks.dbQuery.mock.calls.find(([query]) =>
      String(query).includes("FROM users") && !String(query).includes("COUNT(*)")
    );
    expect(userRowsQuery?.[0]).toContain("to_jsonb(row) - 'password_hash'");
    expect(userRowsQuery?.[1]).toEqual(["tenant-a", "workspace-a", 1]);
    const queriedTables = mocks.dbQuery.mock.calls.map(([query]) => String(query));
    expect(queriedTables.some((query) => query.includes("FROM ai_prompt_templates"))).toBe(true);
    expect(queriedTables.some((query) => query.includes("FROM agent_prompt_templates"))).toBe(false);
  });

  it("includes tenant-scoped object payloads when explicitly requested", async () => {
    const bundle = await exportTenantDataBundle(
      { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      { limitPerSection: 1, includeObjectPayloads: true, objectPayloadMaxBytes: 4096 }
    );

    expect(mocks.getObjectBuffer).toHaveBeenCalledWith(
      "tenants/tenant-a/workspaces/workspace-a/messages/message-1/attachments/invoice.pdf"
    );
    expect(bundle.objectStoragePayloadSummary).toEqual({
      requested: true,
      included: 1,
      skipped: 0,
      maxBytesPerObject: 4096
    });
    expect(bundle.objectStoragePayloads).toEqual([
      expect.objectContaining({
        encoding: "base64",
        contentType: "application/pdf",
        sizeBytes: Buffer.byteLength("invoice-pdf-bytes"),
        base64: Buffer.from("invoice-pdf-bytes").toString("base64"),
        ref: expect.objectContaining({
          section: "attachments",
          rowId: "attachment-1",
          key: "tenants/tenant-a/workspaces/workspace-a/messages/message-1/attachments/invoice.pdf"
        })
      })
    ]);
    expect(bundle.objectStoragePayloads[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.objectStoragePayloadSkips).toEqual([]);
  });

  it("skips object payloads outside the requested tenant workspace prefix", async () => {
    mocks.dbQuery.mockImplementation((query: string) => {
      if (query.includes("COUNT(*)") && query.includes("FROM attachments")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      if (!query.includes("COUNT(*)") && query.includes("FROM attachments")) {
        return Promise.resolve({
          rows: [
            {
              row: {
                id: "attachment-1",
                tenant_key: "tenant-a",
                workspace_key: "workspace-a",
                filename: "invoice.pdf",
                content_type: "application/pdf",
                size_bytes: 2048,
                r2_key: "tenants/tenant-b/workspaces/workspace-b/messages/message-1/attachments/invoice.pdf"
              }
            }
          ]
        });
      }
      if (query.includes("COUNT(*)")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const bundle = await exportTenantDataBundle(
      { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      { includeObjectPayloads: true }
    );

    expect(mocks.getObjectBuffer).not.toHaveBeenCalled();
    expect(bundle.objectStoragePayloads).toEqual([]);
    expect(bundle.objectStoragePayloadSkips).toEqual([
      expect.objectContaining({
        reason: "unsafe_key",
        ref: expect.objectContaining({
          key: "tenants/tenant-b/workspaces/workspace-b/messages/message-1/attachments/invoice.pdf"
        })
      })
    ]);
    expect(bundle.objectStoragePayloadSummary).toMatchObject({
      requested: true,
      included: 0,
      skipped: 1
    });
  });
});
