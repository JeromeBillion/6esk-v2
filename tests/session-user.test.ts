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
  });

  it("uses the impersonated tenant only for internal support roles", async () => {
    mocks.dbQuery.mockResolvedValue({
      rows: [
        sessionRow({
          role_name: "internal_support",
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
      real_tenant_id: "tenant-home",
      is_impersonating: true
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
          impersonated_tenant_id: "tenant-target",
          impersonated_tenant_slug: "target",
          impersonation_expires_at: new Date(Date.now() - 60 * 1000).toISOString()
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
});
