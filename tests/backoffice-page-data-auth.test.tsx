import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  requireBackofficeStaff: vi.fn(),
  getBackofficeOverview: vi.fn(),
  listBackofficeCases: vi.fn(),
  listTenantBackofficeProfiles: vi.fn(),
  listTenants: vi.fn(),
  listBackofficeAuditPreview: vi.fn()
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers
}));

vi.mock("@/server/backoffice/authz", () => ({
  requireBackofficeStaff: mocks.requireBackofficeStaff
}));

vi.mock("@/server/backoffice/overview", () => ({
  getBackofficeOverview: mocks.getBackofficeOverview
}));

vi.mock("@/server/backoffice/workflows", () => ({
  listBackofficeCases: mocks.listBackofficeCases,
  listTenantBackofficeProfiles: mocks.listTenantBackofficeProfiles
}));

vi.mock("@/server/tenant/lifecycle", () => ({
  listTenants: mocks.listTenants
}));

vi.mock("@/server/backoffice/audit-preview", () => ({
  listBackofficeAuditPreview: mocks.listBackofficeAuditPreview
}));

import { getAuthorizedBackofficePageData } from "../apps/backoffice/app/_components/work-data";

const requestHeaders = new Headers({ "x-sixesk-work-access-email": "ops@6esk.co.za" });
const internalUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ops@6esk.co.za",
  display_name: "Ops",
  role_id: "22222222-2222-4222-8222-222222222222",
  role_name: "internal_admin",
  tenant_id: "33333333-3333-4333-8333-333333333333",
  real_tenant_id: "33333333-3333-4333-8333-333333333333",
  tenant_slug: "6esk",
  is_impersonating: false,
  session_auth_provider: "password_mfa"
};

describe("backoffice page data authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(requestHeaders);
    mocks.getBackofficeOverview.mockResolvedValue({
      tenants: {},
      finance: {},
      security: {},
      operations: {}
    });
    mocks.listBackofficeCases.mockResolvedValue([]);
    mocks.listTenantBackofficeProfiles.mockResolvedValue([]);
    mocks.listTenants.mockResolvedValue([]);
    mocks.listBackofficeAuditPreview.mockResolvedValue([]);
  });

  it("does not load server-rendered backoffice data when request-aware auth fails", async () => {
    mocks.requireBackofficeStaff.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Cloudflare Access identity must match the 6esk Work session." }, { status: 403 })
    });

    const result = await getAuthorizedBackofficePageData();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unauthorized");
    }
    expect(mocks.requireBackofficeStaff).toHaveBeenCalledWith(requestHeaders);
    expect(mocks.getBackofficeOverview).not.toHaveBeenCalled();
    expect(mocks.listBackofficeCases).not.toHaveBeenCalled();
  });

  it("loads backoffice data only after the shared guard accepts the request", async () => {
    mocks.requireBackofficeStaff.mockResolvedValue({
      ok: true,
      user: internalUser
    });

    const result = await getAuthorizedBackofficePageData();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.user).toBe(internalUser);
    }
    expect(mocks.getBackofficeOverview).toHaveBeenCalledWith({
      tenantId: internalUser.tenant_id
    });
  });
});
