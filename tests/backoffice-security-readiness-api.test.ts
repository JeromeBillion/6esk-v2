import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  getSecurityReadinessSnapshot: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/security/readiness", () => ({
  getSecurityReadinessSnapshot: mocks.getSecurityReadinessSnapshot
}));

import { GET } from "@/app/api/backoffice/security/readiness/route";

describe("backoffice security readiness API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-internal users", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1" });
    mocks.isInternalStaff.mockReturnValue(false);

    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns readiness snapshot for internal staff", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "u1" });
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getSecurityReadinessSnapshot.mockResolvedValue({ healthy: true });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ healthy: true });
  });
});
