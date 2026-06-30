import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  hasPrivilegedMfaSession: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/auth/privileged-access", () => ({
  hasPrivilegedMfaSession: mocks.hasPrivilegedMfaSession
}));

import {
  requireBackofficeSensitiveAccess,
  requireBackofficeStaff
} from "@/server/backoffice/authz";

const originalNodeEnv = process.env.NODE_ENV;
const originalRequireAccess = process.env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS;

function enableProductionAccess() {
  process.env.NODE_ENV = "production";
  process.env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS = "true";
}

function internalUser(email = "ops@6esk.co.za") {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email,
    display_name: "Ops",
    role_name: "internal_admin",
    tenant_id: "22222222-2222-4222-8222-222222222222",
    real_tenant_id: "22222222-2222-4222-8222-222222222222",
    tenant_slug: "6esk",
    is_impersonating: false,
    session_auth_provider: "password_mfa"
  };
}

describe("backoffice Access/session binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(internalUser());
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.hasPrivilegedMfaSession.mockReturnValue(true);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalRequireAccess === undefined) {
      delete process.env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS;
    } else {
      process.env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS = originalRequireAccess;
    }
  });

  it("rejects internal sessions whose Cloudflare Access email differs in production", async () => {
    enableProductionAccess();

    const auth = await requireBackofficeStaff(
      new Headers({ "x-sixesk-work-access-email": "other@6esk.co.za" })
    );

    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(403);
      expect(await auth.response.json()).toEqual({
        error: "Cloudflare Access identity must match the 6esk Work session."
      });
    }
  });

  it("allows matching Cloudflare Access and session emails in production", async () => {
    enableProductionAccess();

    const auth = await requireBackofficeSensitiveAccess(
      new Headers({ "x-sixesk-work-access-email": "OPS@6ESK.CO.ZA" })
    );

    expect(auth.ok).toBe(true);
    expect(mocks.hasPrivilegedMfaSession).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ops@6esk.co.za" })
    );
  });

  it("keeps local development independent of Cloudflare Access headers", async () => {
    process.env.NODE_ENV = "development";
    process.env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS = "true";

    const auth = await requireBackofficeStaff();

    expect(auth.ok).toBe(true);
  });
});
