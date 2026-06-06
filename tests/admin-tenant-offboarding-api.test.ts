import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  resolveTenantDataAccess: vi.fn(),
  privilegedAccessErrorResponse: vi.fn(),
  recordAuditLog: vi.fn(),
  previewTenantOffboarding: vi.fn(),
  executeTenantOffboardingAnonymization: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionContext: mocks.getSessionContext
}));

vi.mock("@/server/auth/privileged-access-authorization", () => ({
  resolveTenantDataAccess: mocks.resolveTenantDataAccess,
  privilegedAccessErrorResponse: mocks.privilegedAccessErrorResponse
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/tenant-offboarding", () => ({
  previewTenantOffboarding: mocks.previewTenantOffboarding,
  executeTenantOffboardingAnonymization: mocks.executeTenantOffboardingAnonymization,
  tenantOffboardingErrorResponse: (error: unknown) => {
    if (error instanceof Error && error.message === "blocked") {
      return Response.json({ error: "blocked" }, { status: 409 });
    }
    return null;
  }
}));

import { POST } from "@/app/api/admin/tenant/offboarding/route";

function buildReport(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: "tenant-offboarding.v1",
    operationId: "11111111-1111-1111-1111-111111111111",
    generatedAt: "2026-06-05T00:00:00.000Z",
    tenantKey: "tenant-a",
    workspaceKey: "workspace-a",
    mode: "anonymize",
    dryRun: true,
    confirmationRequired: "ANONYMIZE tenant-a/workspace-a",
    totalRows: 12,
    tableCount: 4,
    blockers: [],
    warnings: [],
    residualRisks: [],
    legalHold: { knowledgeDocumentCount: 0 },
    tables: [],
    mutations: [],
    ...overrides
  };
}

describe("admin tenant offboarding API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa",
      user: {
        id: "user-1",
        email: "lead@example.test",
        role_name: "lead_admin",
        tenant_key: "tenant-a",
        workspace_key: "workspace-a"
      }
    });
    mocks.resolveTenantDataAccess.mockResolvedValue({
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      mode: "tenant_admin",
      actorUserId: "user-1",
      grant: null
    });
    mocks.privilegedAccessErrorResponse.mockReturnValue(null);
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.previewTenantOffboarding.mockResolvedValue(buildReport());
    mocks.executeTenantOffboardingAnonymization.mockResolvedValue(buildReport({ dryRun: false, mutations: [] }));
  });

  it("returns a privileged offboarding preview and audits the preview", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/tenant/offboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "anonymize", dryRun: true })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "preview",
      offboarding: {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        confirmationRequired: "ANONYMIZE tenant-a/workspace-a"
      }
    });
    expect(mocks.resolveTenantDataAccess).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ id: "user-1" }),
      expect.objectContaining({ operation: "tenant_offboarding", accessTypes: ["break_glass"] })
    );
    expect(mocks.previewTenantOffboarding).toHaveBeenCalledWith(
      { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      { mode: "anonymize" }
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        action: "tenant_offboarding_preview_created",
        entityId: "11111111-1111-1111-1111-111111111111"
      })
    );
  });

  it("executes anonymization only when dryRun is false", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/tenant/offboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "anonymize",
          dryRun: false,
          confirmation: "ANONYMIZE tenant-a/workspace-a",
          reason: "Customer requested contractual offboarding"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.executeTenantOffboardingAnonymization).toHaveBeenCalledWith({
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      confirmation: "ANONYMIZE tenant-a/workspace-a",
      reason: "Customer requested contractual offboarding",
      actorUserId: "user-1",
      accessMode: "tenant_admin",
      privilegedAccessGrantId: null
    });
    expect(mocks.previewTenantOffboarding).not.toHaveBeenCalled();
  });

  it("keeps physical delete preview-only", async () => {
    mocks.previewTenantOffboarding.mockResolvedValue(
      buildReport({
        mode: "delete",
        blockers: ["Physical tenant delete remains preview-only until backup/restore is proven."]
      })
    );

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/offboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "delete", dryRun: false })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.status).toBe("blocked");
    expect(mocks.executeTenantOffboardingAnonymization).not.toHaveBeenCalled();
  });
});
