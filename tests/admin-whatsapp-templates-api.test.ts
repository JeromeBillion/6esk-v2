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

import {
  GET as LIST,
  POST
} from "@/app/api/admin/whatsapp/templates/route";
import {
  DELETE,
  PATCH
} from "@/app/api/admin/whatsapp/templates/[templateId]/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-wa",
    workspace_key: "workspace-wa"
  };
}

describe("admin WhatsApp templates API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
  });

  it("scopes template list and save operations to the admin workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const listResponse = await LIST();

    expect(listResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE tenant_key = $1"),
      ["tenant-wa", "workspace-wa"]
    );

    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "template-1",
          provider: "meta",
          name: "shipping_update",
          language: "en_US",
          category: null,
          status: "active",
          components: null
        }
      ]
    });

    const saveResponse = await POST(
      new Request("http://localhost/api/admin/whatsapp/templates", {
        method: "POST",
        body: JSON.stringify({ name: "shipping_update" })
      })
    );

    expect(saveResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("ON CONFLICT (tenant_key, workspace_key, provider, name, language)"),
      ["tenant-wa", "workspace-wa", "meta", "shipping_update", "en_US", null, "active", null]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-wa",
        workspaceKey: "workspace-wa",
        action: "whatsapp_template_saved",
        entityId: "template-1"
      })
    );
  });

  it("scopes template update and delete operations to the admin workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "template-1",
          provider: "meta",
          name: "shipping_update",
          language: "en_US",
          category: null,
          status: "paused",
          components: null
        }
      ]
    });

    const patchResponse = await PATCH(
      new Request("http://localhost/api/admin/whatsapp/templates/template-1", {
        method: "PATCH",
        body: JSON.stringify({ status: "paused" })
      }),
      { params: Promise.resolve({ templateId: "template-1" }) }
    );

    expect(patchResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND workspace_key = $4"),
      ["paused", "template-1", "tenant-wa", "workspace-wa"]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-wa",
        workspaceKey: "workspace-wa",
        action: "whatsapp_template_updated",
        entityId: "template-1"
      })
    );

    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ id: "template-1", name: "shipping_update", language: "en_US" }]
    });

    const deleteResponse = await DELETE(
      new Request("http://localhost/api/admin/whatsapp/templates/template-1", {
        method: "DELETE"
      }),
      { params: Promise.resolve({ templateId: "template-1" }) }
    );

    expect(deleteResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND workspace_key = $3"),
      ["template-1", "tenant-wa", "workspace-wa"]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-wa",
        workspaceKey: "workspace-wa",
        action: "whatsapp_template_deleted",
        entityId: "template-1"
      })
    );
  });
});
