import { afterEach, describe, expect, it } from "vitest";
import {
  buildTenantIngressSignature,
  shouldRequireTenantIngressSignature,
  shouldRequireTenantIngressScope,
  tenantScopeFromMachineRequest
} from "@/server/tenant-context";

const ORIGINAL_ENV = { ...process.env };
const TENANT_INGRESS_SECRET = "tenant-ingress-secret";

function requestWithHeaders(
  headers: Record<string, string> = {},
  init: { method?: string; url?: string } = {}
) {
  return new Request(init.url ?? "http://localhost/internal", {
    method: init.method ?? "GET",
    headers
  });
}

function signedTenantHeaders({
  tenantKey = "tenant-a",
  workspaceKey = "workspace-a",
  method = "GET",
  path = "/internal",
  timestamp = new Date().toISOString(),
  secret = TENANT_INGRESS_SECRET
}: {
  tenantKey?: string;
  workspaceKey?: string;
  method?: string;
  path?: string;
  timestamp?: string;
  secret?: string;
} = {}) {
  return {
    "x-6esk-tenant": tenantKey,
    "x-6esk-workspace": workspaceKey,
    "x-6esk-tenant-timestamp": timestamp,
    "x-6esk-tenant-signature": buildTenantIngressSignature({
      tenantKey,
      workspaceKey,
      method,
      path,
      timestamp,
      secret
    })
  };
}

describe("tenant ingress scope", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("keeps primary fallback only when strict ingress scope is disabled", () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test", TENANT_INGRESS_REQUIRE_SCOPE: "false" };

    expect(shouldRequireTenantIngressScope()).toBe(false);
    expect(tenantScopeFromMachineRequest(requestWithHeaders())).toEqual({
      tenantKey: "primary",
      workspaceKey: "primary"
    });
  });

  it("requires explicit tenant and workspace headers when strict mode is enabled", () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test", TENANT_INGRESS_REQUIRE_SCOPE: "true" };

    expect(() => tenantScopeFromMachineRequest(requestWithHeaders())).toThrow(
      "Tenant scope is required for machine ingress."
    );
    expect(() =>
      tenantScopeFromMachineRequest(requestWithHeaders({ "x-6esk-tenant": "tenant-a" }))
    ).toThrow("Both x-6esk-tenant and x-6esk-workspace are required");
  });

  it("requires explicit tenant scope by default in production", () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "production" };

    expect(shouldRequireTenantIngressScope()).toBe(true);
    expect(shouldRequireTenantIngressSignature()).toBe(true);
    expect(() => tenantScopeFromMachineRequest(requestWithHeaders())).toThrow(
      "Tenant scope is required for machine ingress."
    );
  });

  it("returns the supplied machine ingress scope", () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "production",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "false"
    };

    expect(
      tenantScopeFromMachineRequest(
        requestWithHeaders({
          "x-6esk-tenant": "tenant-a",
          "x-6esk-workspace": "workspace-a"
        })
      )
    ).toEqual({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
  });

  it("requires a signed tenant envelope when signature strict mode is enabled", () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_INGRESS_REQUIRE_SCOPE: "true",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "true",
      TENANT_INGRESS_SIGNING_SECRETS_JSON: JSON.stringify({
        "tenant-a:workspace-a": TENANT_INGRESS_SECRET
      })
    };

    expect(shouldRequireTenantIngressSignature()).toBe(true);
    expect(() =>
      tenantScopeFromMachineRequest(
        requestWithHeaders(
          {
            "x-6esk-tenant": "tenant-a",
            "x-6esk-workspace": "workspace-a"
          },
          { method: "POST", url: "http://localhost/internal?job=metrics" }
        )
      )
    ).toThrow("Signed tenant envelope is required for machine ingress.");
  });

  it("accepts a valid signed tenant envelope", () => {
    const path = "/internal?job=metrics";
    const timestamp = new Date().toISOString();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_INGRESS_REQUIRE_SCOPE: "true",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "true",
      TENANT_INGRESS_SIGNING_SECRETS_JSON: JSON.stringify({
        "tenant-a:workspace-a": TENANT_INGRESS_SECRET
      })
    };

    expect(
      tenantScopeFromMachineRequest(
        requestWithHeaders(signedTenantHeaders({ method: "POST", path, timestamp }), {
          method: "POST",
          url: `http://localhost${path}`
        })
      )
    ).toEqual({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
  });

  it("rejects a tampered signed tenant envelope", () => {
    const path = "/internal?job=metrics";
    const timestamp = new Date().toISOString();
    const headers = signedTenantHeaders({ method: "POST", path, timestamp });
    headers["x-6esk-workspace"] = "workspace-b";
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_INGRESS_REQUIRE_SCOPE: "true",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "true",
      TENANT_INGRESS_SIGNING_SECRETS_JSON: JSON.stringify({
        "tenant-a:*": TENANT_INGRESS_SECRET
      })
    };

    expect(() =>
      tenantScopeFromMachineRequest(
        requestWithHeaders(headers, {
          method: "POST",
          url: `http://localhost${path}`
        })
      )
    ).toThrow("Tenant ingress signature is invalid.");
  });

  it("rejects stale signed tenant envelopes", () => {
    const path = "/internal?job=metrics";
    const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_INGRESS_REQUIRE_SCOPE: "true",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "true",
      TENANT_INGRESS_SIGNATURE_MAX_SKEW_SECONDS: "60",
      TENANT_INGRESS_SIGNING_SECRETS_JSON: JSON.stringify({
        "tenant-a:workspace-a": TENANT_INGRESS_SECRET
      })
    };

    expect(() =>
      tenantScopeFromMachineRequest(
        requestWithHeaders(signedTenantHeaders({ method: "POST", path, timestamp }), {
          method: "POST",
          url: `http://localhost${path}`
        })
      )
    ).toThrow("Tenant ingress signature timestamp is outside the replay window.");
  });

  it("does not use the global signing secret in production unless explicitly allowed", () => {
    const path = "/internal";
    const timestamp = new Date().toISOString();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "production",
      TENANT_INGRESS_REQUIRE_SCOPE: "true",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "true",
      TENANT_INGRESS_SIGNING_SECRET: TENANT_INGRESS_SECRET,
      TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET: "false"
    };

    expect(() =>
      tenantScopeFromMachineRequest(
        requestWithHeaders(signedTenantHeaders({ path, timestamp }), {
          url: `http://localhost${path}`
        })
      )
    ).toThrow("Tenant ingress signing secret is not configured.");
  });
});
