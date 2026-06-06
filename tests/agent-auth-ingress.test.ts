import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveAgentIntegration: vi.fn(),
  getAgentIntegrationById: vi.fn(),
  listActiveTenantIngressSigningSecrets: vi.fn(),
  markTenantIngressSigningSecretUsed: vi.fn()
}));

vi.mock("@/server/agents/integrations", () => ({
  getActiveAgentIntegration: mocks.getActiveAgentIntegration,
  getAgentIntegrationById: mocks.getAgentIntegrationById
}));

vi.mock("@/server/tenant-ingress-secrets", () => ({
  listActiveTenantIngressSigningSecrets: mocks.listActiveTenantIngressSigningSecrets,
  markTenantIngressSigningSecretUsed: mocks.markTenantIngressSigningSecretUsed
}));

import {
  agentIngressErrorResponse,
  getAgentFromRequest
} from "@/server/agents/auth";
import {
  buildTenantIngressSignature,
  TenantIngressScopeError
} from "@/server/tenant-context";

const ORIGINAL_ENV = { ...process.env };
const AGENT_SECRET = "agent-secret";
const TENANT_SECRET = "tenant-ingress-secret";

function integration(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    tenant_key: "tenant-a",
    name: "Dexter",
    provider: "elizaos",
    base_url: "https://dexter.example.com",
    auth_type: "hmac",
    shared_secret: AGENT_SECRET,
    status: "active",
    policy_mode: "hybrid_review",
    scopes: {},
    capabilities: {},
    policy: {},
    created_at: "2026-05-31T00:00:00.000Z",
    updated_at: "2026-05-31T00:00:00.000Z",
    ...overrides
  };
}

function requestWithHeaders(headers: Record<string, string>, path = "/api/agent/v1/actions") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers
  });
}

function signedAgentHeaders({
  tenantKey = "tenant-a",
  workspaceKey = "workspace-a",
  path = "/api/agent/v1/actions",
  timestamp = new Date().toISOString(),
  tenantSecret = TENANT_SECRET
}: {
  tenantKey?: string;
  workspaceKey?: string;
  path?: string;
  timestamp?: string;
  tenantSecret?: string;
} = {}) {
  return {
    "x-6esk-agent-id": "agent-1",
    "x-6esk-agent-key": AGENT_SECRET,
    "x-6esk-tenant": tenantKey,
    "x-6esk-workspace": workspaceKey,
    "x-6esk-tenant-timestamp": timestamp,
    "x-6esk-tenant-signature": buildTenantIngressSignature({
      tenantKey,
      workspaceKey,
      method: "POST",
      path,
      timestamp,
      secret: tenantSecret
    })
  };
}

describe("agent ingress authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test" };
    mocks.getAgentIntegrationById.mockResolvedValue(integration());
    mocks.getActiveAgentIntegration.mockResolvedValue(integration());
    mocks.listActiveTenantIngressSigningSecrets.mockResolvedValue([]);
    mocks.markTenantIngressSigningSecretUsed.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("keeps legacy tenant-only lookup only when strict ingress is disabled", async () => {
    process.env.TENANT_INGRESS_REQUIRE_SCOPE = "false";
    process.env.TENANT_INGRESS_REQUIRE_SIGNATURE = "false";

    const result = await getAgentFromRequest(
      requestWithHeaders({
        "x-6esk-agent-id": "agent-1",
        "x-6esk-agent-key": AGENT_SECRET,
        "x-6esk-tenant": "tenant-a"
      })
    );

    expect(result).toMatchObject({
      id: "agent-1",
      tenant_key: "tenant-a",
      workspace_key: "primary",
      tenant_scope: {
        tenantKey: "tenant-a",
        workspaceKey: "primary"
      }
    });
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", {
      tenantKey: "tenant-a",
      workspaceKey: "primary"
    });
  });

  it("requires an explicit tenant scope before integration lookup in strict mode", async () => {
    process.env.TENANT_INGRESS_REQUIRE_SCOPE = "true";
    process.env.TENANT_INGRESS_REQUIRE_SIGNATURE = "false";

    await expect(
      getAgentFromRequest(
        requestWithHeaders({
          "x-6esk-agent-id": "agent-1",
          "x-6esk-agent-key": AGENT_SECRET
        })
      )
    ).rejects.toMatchObject({
      code: "tenant_scope_required"
    });
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
  });

  it("accepts signed tenant envelopes and preserves workspace scope", async () => {
    process.env.TENANT_INGRESS_REQUIRE_SCOPE = "true";
    process.env.TENANT_INGRESS_REQUIRE_SIGNATURE = "true";
    process.env.TENANT_INGRESS_SIGNING_SECRETS_JSON = JSON.stringify({
      "tenant-a:workspace-a": TENANT_SECRET,
      "tenant-a:workspace-b": TENANT_SECRET
    });

    const result = await getAgentFromRequest(requestWithHeaders(signedAgentHeaders()));

    expect(result).toMatchObject({
      id: "agent-1",
      tenant_key: "tenant-a",
      workspace_key: "workspace-a",
      tenant_scope: {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      }
    });
    expect(mocks.getAgentIntegrationById).toHaveBeenCalledWith("agent-1", {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
  });

  it("rejects tampered signed tenant envelopes", async () => {
    process.env.TENANT_INGRESS_REQUIRE_SCOPE = "true";
    process.env.TENANT_INGRESS_REQUIRE_SIGNATURE = "true";
    process.env.TENANT_INGRESS_SIGNING_SECRETS_JSON = JSON.stringify({
      "tenant-a:*": TENANT_SECRET
    });
    const headers = signedAgentHeaders();
    headers["x-6esk-workspace"] = "workspace-b";

    await expect(getAgentFromRequest(requestWithHeaders(headers))).rejects.toMatchObject({
      code: "tenant_signature_invalid"
    });
    expect(mocks.getAgentIntegrationById).not.toHaveBeenCalled();
  });

  it("turns tenant ingress errors into route-safe JSON responses", async () => {
    const response = agentIngressErrorResponse(
      new TenantIngressScopeError(
        "Signed tenant envelope is required for machine ingress.",
        "tenant_signature_required",
        401
      )
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      code: "tenant_signature_required"
    });
  });
});
