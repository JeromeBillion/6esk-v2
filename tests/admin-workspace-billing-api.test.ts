import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbConnect: vi.fn(),
  dbQuery: vi.fn(),
  getSessionUser: vi.fn(),
  isTenantAdmin: vi.fn(),
  getTenantById: vi.fn(),
  getTenantBillingLifecycleSnapshot: vi.fn(),
  getCustomerSafeInvoiceExport: vi.fn(),
  encrypt: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    connect: mocks.dbConnect,
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isTenantAdmin: mocks.isTenantAdmin
}));

vi.mock("@/server/tenant/lifecycle", () => ({
  getTenantById: mocks.getTenantById
}));

vi.mock("@/server/security/encryption", () => ({
  encrypt: mocks.encrypt
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/billing/lifecycle", () => ({
  getTenantBillingLifecycleSnapshot: mocks.getTenantBillingLifecycleSnapshot,
  getCustomerSafeInvoiceExport: mocks.getCustomerSafeInvoiceExport
}));

import { GET, PATCH } from "@/app/api/admin/workspace/billing/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("workspace billing admin API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1",
      tenant_id: TENANT_ID,
      role_name: "tenant_admin"
    });
    mocks.isTenantAdmin.mockReturnValue(true);
    mocks.getTenantById.mockResolvedValue({
      id: TENANT_ID,
      plan: "standard",
      status: "active",
      settings: { aiProviderMode: "managed" }
    });
    mocks.getTenantBillingLifecycleSnapshot.mockResolvedValue({
      tenantId: TENANT_ID,
      estimatedInvoice: { totalCent: 119800 }
    });
    mocks.getCustomerSafeInvoiceExport.mockResolvedValue({
      formatVersion: "workspace-invoice-export.v1",
      workspaceKey: "primary",
      invoice: {
        status: "open",
        invoiceNumber: "6ESK-202606-000001",
        lines: []
      }
    });
    mocks.dbConnect.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      release: vi.fn()
    });
    mocks.encrypt.mockReturnValue("encrypted-key");
  });

  it("returns tenant billing settings with lifecycle invoice visibility", async () => {
    const response = await GET(new Request("http://localhost/api/admin/workspace/billing"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.billingLifecycle).toMatchObject({
      tenantId: TENANT_ID,
      estimatedInvoice: { totalCent: 119800 }
    });
    expect(mocks.getTenantBillingLifecycleSnapshot).toHaveBeenCalledWith({ tenantId: TENANT_ID });
  });

  it("blocks admin-looking billing access without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1",
      tenant_id: "",
      role_name: "tenant_admin"
    });

    const response = await GET(new Request("http://localhost/api/admin/workspace/billing"));

    expect(response.status).toBe(403);
    expect(mocks.getTenantById).not.toHaveBeenCalled();
    expect(mocks.getTenantBillingLifecycleSnapshot).not.toHaveBeenCalled();
  });

  it("exports a customer-safe invoice and audits export metadata only", async () => {
    const invoiceId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const response = await GET(
      new Request(`http://localhost/api/admin/workspace/billing?invoiceId=${invoiceId}`)
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      formatVersion: "workspace-invoice-export.v1",
      invoice: { status: "open", lines: [] }
    });
    expect(mocks.getCustomerSafeInvoiceExport).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      invoiceId
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "billing_invoice_exported",
        entityType: "tenant_invoice",
        entityId: invoiceId,
        data: expect.objectContaining({
          formatVersion: "workspace-invoice-export.v1",
          workspaceKey: "primary",
          status: "open",
          lineCount: 0
        })
      })
    );
    expect(JSON.stringify(body)).not.toContain("tenant_id");
  });

  it("rejects private BYO AI provider base URLs", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/admin/workspace/billing", {
        method: "PATCH",
        body: JSON.stringify({
          aiProviderMode: "byo",
          aiProviderBaseUrl: "https://127.0.0.1:11434"
        })
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.dbConnect).not.toHaveBeenCalled();
  });

  it("stores public BYO AI provider base URLs", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/admin/workspace/billing", {
        method: "PATCH",
        body: JSON.stringify({
          aiProviderMode: "byo",
          aiProviderBaseUrl: "https://api.groq.com/openai/v1",
          aiProviderApiKey: "tenant-key"
        })
      })
    );

    expect(response.status).toBe(200);
    const client = await mocks.dbConnect.mock.results[0].value;
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE tenants SET settings"),
      [
        JSON.stringify({
          aiProviderMode: "byo",
          aiProviderBaseUrl: "https://api.groq.com/openai/v1",
          aiProviderApiKey: "encrypted-key"
        }),
        TENANT_ID
      ]
    );
  });
});
