import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  dbQuery: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/whatsapp/templates/route";
import {
  DELETE as DELETE_TEMPLATE,
  PATCH
} from "@/app/api/admin/whatsapp/templates/[templateId]/route";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "admin@6ex.co.za",
    display_name: "Admin",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

function templateParams() {
  return { params: Promise.resolve({ templateId: TEMPLATE_ID }) };
}

describe("WhatsApp template admin APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLeadAdmin.mockImplementation((user) => user?.role_name === "lead_admin");
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("lists templates for the session tenant", async () => {
    await GET();

    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = $1"), [TENANT_ID]);
  });

  it("returns 403 for tenantless lead admin list/create/update/delete", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const listResponse = await GET();
    const createResponse = await POST(
      new Request("http://localhost/api/admin/whatsapp/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "support_followup", language: "en_US" })
      })
    );
    const patchResponse = await PATCH(
      new Request(`http://localhost/api/admin/whatsapp/templates/${TEMPLATE_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "paused" })
      }),
      templateParams()
    );
    const deleteResponse = await DELETE_TEMPLATE(
      new Request(`http://localhost/api/admin/whatsapp/templates/${TEMPLATE_ID}`, {
        method: "DELETE"
      }),
      templateParams()
    );

    expect(listResponse.status).toBe(403);
    expect(createResponse.status).toBe(403);
    expect(patchResponse.status).toBe(403);
    expect(deleteResponse.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("creates templates under the session tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: TEMPLATE_ID,
          provider: "meta",
          name: "support_followup",
          language: "en_US",
          category: null,
          status: "active",
          components: null
        }
      ],
      rowCount: 1
    });

    const response = await POST(
      new Request("http://localhost/api/admin/whatsapp/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "support_followup", language: "en_US" })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO whatsapp_templates"),
      expect.arrayContaining([TENANT_ID])
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "whatsapp_template_saved"
      })
    );
  });
});
