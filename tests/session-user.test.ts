import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  cookieGet: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
    set: vi.fn()
  }))
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { getSessionUser } from "@/server/auth/session";
import { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from "@/server/tenant/types";

function sessionRow(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    id: "user-1",
    email: "agent@example.com",
    display_name: "Agent",
    role_id: "role-1",
    role_name: "agent",
    real_tenant_id: "tenant-home",
    home_tenant_slug: "home",
    impersonated_tenant_id: null,
    impersonated_tenant_slug: null,
    impersonation_expires_at: null,
    session_auth_provider: null,
    ...overrides
  };
}

describe("getSessionUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "session-secret-long-enough";
    mocks.cookieGet.mockReturnValue({ value: "raw-session-token" });
  });

  it("returns the home tenant for a normal session", async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [sessionRow()] });

    const user = await getSessionUser();

    expect(user).toMatchObject({
      id: "user-1",
      tenant_id: "tenant-home",
      tenant_slug: "home",
      real_tenant_id: "tenant-home",
      is_impersonating: false
    });
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("JOIN tenants t ON t.id = u.tenant_id");
    expect(mocks.dbQuery.mock.calls[0][0]).toContain(
      "LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id"
    );
  });

  it("fails closed when the session user has no home tenant", async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [sessionRow({ real_tenant_id: null, home_tenant_slug: null })]
    });

    const user = await getSessionUser();

    expect(user).toBeNull();
  });

  it("uses the impersonated tenant only for internal support roles", async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [
        sessionRow({
          role_name: "internal_support",
          real_tenant_id: DEFAULT_TENANT_ID,
          home_tenant_slug: DEFAULT_TENANT_SLUG,
          session_auth_provider: "google_oauth_mfa",
          impersonated_tenant_id: "tenant-target",
          impersonated_tenant_slug: "target",
          impersonation_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })
      ]
    });

    const user = await getSessionUser();

    expect(user).toMatchObject({
      tenant_id: "tenant-target",
      tenant_slug: "target",
      real_tenant_id: DEFAULT_TENANT_ID,
      is_impersonating: true
    });
  });

  it("ignores impersonation state for tenant-owned internal role names", async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [
        sessionRow({
          role_name: "internal_support",
          session_auth_provider: "google_oauth_mfa",
          impersonated_tenant_id: "tenant-target",
          impersonated_tenant_slug: "target",
          impersonation_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })
      ]
    });

    const user = await getSessionUser();

    expect(user).toMatchObject({
      tenant_id: "tenant-home",
      tenant_slug: "home",
      is_impersonating: false
    });
  });

  it("ignores impersonation state for non-internal roles", async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [
        sessionRow({
          role_name: "agent",
          impersonated_tenant_id: "tenant-target",
          impersonated_tenant_slug: "target",
          impersonation_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })
      ]
    });

    const user = await getSessionUser();

    expect(user).toMatchObject({
      tenant_id: "tenant-home",
      tenant_slug: "home",
      is_impersonating: false
    });
  });

  it("ignores expired impersonation state", async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [
        sessionRow({
          role_name: "internal_support",
          real_tenant_id: DEFAULT_TENANT_ID,
          home_tenant_slug: DEFAULT_TENANT_SLUG,
          session_auth_provider: "google_oauth_mfa",
          impersonated_tenant_id: "tenant-target",
          impersonated_tenant_slug: "target",
          impersonation_expires_at: new Date(Date.now() - 60 * 1000).toISOString()
        })
      ]
    });

    const user = await getSessionUser();

    expect(user).toMatchObject({
      tenant_id: DEFAULT_TENANT_ID,
      tenant_slug: DEFAULT_TENANT_SLUG,
      is_impersonating: false
    });
  });
});
