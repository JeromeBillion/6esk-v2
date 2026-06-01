import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/spam-rules/route";
import { DELETE, PATCH } from "@/app/api/admin/spam-rules/[ruleId]/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-spam",
    workspace_key: "workspace-spam"
  };
}

describe("admin spam rules API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
  });

  it("scopes spam rule list and create operations to the admin workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const listResponse = await GET();
    expect(listResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE tenant_key = $1"),
      ["tenant-spam", "workspace-spam"]
    );

    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "rule-1",
          rule_type: "block",
          scope: "sender",
          pattern: "bad@example.com",
          is_active: true,
          created_at: "2026-06-01T00:00:00.000Z"
        }
      ]
    });

    const createResponse = await POST(
      new Request("http://localhost/api/admin/spam-rules", {
        method: "POST",
        body: JSON.stringify({
          ruleType: "block",
          scope: "sender",
          pattern: "BAD@example.com"
        })
      })
    );
    const createBody = await createResponse.json();

    expect(createResponse.status).toBe(200);
    expect(createBody.rule.id).toBe("rule-1");
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO spam_rules (tenant_key, workspace_key"),
      ["tenant-spam", "workspace-spam", "block", "sender", "bad@example.com"]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-spam",
        workspaceKey: "workspace-spam",
        action: "spam_rule_created",
        entityId: "rule-1"
      })
    );
  });

  it("scopes spam rule update and delete operations to the admin workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "rule-1",
          rule_type: "block",
          scope: "sender",
          pattern: "bad@example.com",
          is_active: false,
          created_at: "2026-06-01T00:00:00.000Z"
        }
      ]
    });

    const patchResponse = await PATCH(
      new Request("http://localhost/api/admin/spam-rules/rule-1", {
        method: "PATCH",
        body: JSON.stringify({ isActive: false })
      }),
      { params: Promise.resolve({ ruleId: "rule-1" }) }
    );

    expect(patchResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND tenant_key = $3"),
      [false, "rule-1", "tenant-spam", "workspace-spam"]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-spam",
        workspaceKey: "workspace-spam",
        action: "spam_rule_updated",
        entityId: "rule-1"
      })
    );

    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: "rule-1" }] });

    const deleteResponse = await DELETE(
      new Request("http://localhost/api/admin/spam-rules/rule-1", { method: "DELETE" }),
      { params: Promise.resolve({ ruleId: "rule-1" }) }
    );

    expect(deleteResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND workspace_key = $3"),
      ["rule-1", "tenant-spam", "workspace-spam"]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-spam",
        workspaceKey: "workspace-spam",
        action: "spam_rule_deleted",
        entityId: "rule-1"
      })
    );
  });
});
