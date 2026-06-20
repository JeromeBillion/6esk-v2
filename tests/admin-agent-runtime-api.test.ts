import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getDexterRuntimeStatus: vi.fn(),
  resolveTenantAiProviderPlan: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/dexter-runtime", () => ({
  getDexterRuntimeStatus: mocks.getDexterRuntimeStatus
}));

vi.mock("@/server/ai/provider-gateway", () => ({
  resolveTenantAiProviderPlan: mocks.resolveTenantAiProviderPlan
}));

import { GET } from "@/app/api/admin/agents/runtime/route";

function buildUser(roleName: "lead_admin" | "agent", tenantId = "00000000-0000-0000-0000-000000000001") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: tenantId
  };
}

describe("GET /api/admin/agents/runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDexterRuntimeStatus.mockReturnValue({
      state: "active",
      enabled: true,
      mode: "native",
      configuredAgentCount: 1,
      activeAgentCount: 1,
      internalDispatcherReady: true,
      startedAt: "2026-05-09T10:00:00.000Z",
      updatedAt: "2026-05-09T10:00:01.000Z",
      failureReason: null
    });
    mocks.resolveTenantAiProviderPlan.mockResolvedValue({
      tenantId: "00000000-0000-0000-0000-000000000001",
      status: "ready",
      providerMode: "managed",
      provider: "openai",
      model: "gpt-5-mini",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret-key",
      timeoutMs: 15000,
      fallbackModels: ["gpt-5-nano"],
      costCapture: {
        moduleKey: "aiAutomation",
        unit: "tokens",
        providerMode: "managed"
      },
      denialReason: null
    });
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.getDexterRuntimeStatus).not.toHaveBeenCalled();
    expect(mocks.resolveTenantAiProviderPlan).not.toHaveBeenCalled();
  });

  it("returns 403 for lead admins without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", ""));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.getDexterRuntimeStatus).not.toHaveBeenCalled();
    expect(mocks.resolveTenantAiProviderPlan).not.toHaveBeenCalled();
  });

  it("returns Dexter runtime and secret-free provider status for tenant-scoped lead admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      runtime: {
        state: "active",
        enabled: true,
        mode: "native",
        internalDispatcherReady: true
      }
    });
    expect(body.providerGateway).toMatchObject({
      status: "ready",
      providerMode: "managed",
      provider: "openai",
      model: "gpt-5-mini",
      timeoutMs: 15000,
      fallbackModels: ["gpt-5-nano"],
      denialReason: null
    });
    expect(body.providerGateway).not.toHaveProperty("apiKey");
    expect(body.providerGateway).not.toHaveProperty("baseUrl");
    expect(mocks.getDexterRuntimeStatus).toHaveBeenCalledTimes(1);
    expect(mocks.resolveTenantAiProviderPlan).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
  });
});
