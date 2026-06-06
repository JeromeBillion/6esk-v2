import { createRequire } from "module";
import { afterEach, describe, expect, it } from "vitest";
import { tenantScopeFromMachineRequest } from "@/server/tenant-context";

const require = createRequire(import.meta.url);
const { tenantIngressHeaders } = require("../scripts/tenant-ingress-headers.js") as {
  tenantIngressHeaders: (input: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
  }) => Record<string, string>;
};

const ORIGINAL_ENV = { ...process.env };
const TENANT_INGRESS_SECRET = "tenant-ingress-secret";

describe("script tenant ingress headers", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("keeps legacy headers when tenant ingress strict mode is disabled", () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_INGRESS_REQUIRE_SCOPE: "false",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "false"
    };

    expect(
      tenantIngressHeaders({
        url: "http://localhost/api/admin/inbound/retry?limit=25",
        method: "POST",
        headers: { "x-6esk-secret": "inbound-secret" }
      })
    ).toEqual({ "x-6esk-secret": "inbound-secret" });
  });

  it("requires script tenant scope when signatures are required", () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_INGRESS_REQUIRE_SCOPE: "true",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "true"
    };

    expect(() =>
      tenantIngressHeaders({
        url: "http://localhost/api/admin/inbound/retry?limit=25",
        method: "POST",
        headers: { "x-6esk-secret": "inbound-secret" }
      })
    ).toThrow("TENANT_INGRESS_TENANT and TENANT_INGRESS_WORKSPACE are required");
  });

  it("generates a signed envelope that passes server verification", () => {
    const url = "http://localhost/api/admin/calls/outbox?limit=25";
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_INGRESS_REQUIRE_SCOPE: "true",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "true",
      TENANT_INGRESS_TENANT: "tenant-a",
      TENANT_INGRESS_WORKSPACE: "workspace-a",
      TENANT_INGRESS_SIGNING_SECRETS_JSON: JSON.stringify({
        "tenant-a:workspace-a": TENANT_INGRESS_SECRET
      })
    };

    const headers = tenantIngressHeaders({
      url,
      method: "POST",
      headers: { "x-6esk-secret": "calls-secret" }
    });

    expect(headers).toMatchObject({
      "x-6esk-secret": "calls-secret",
      "x-6esk-tenant": "tenant-a",
      "x-6esk-workspace": "workspace-a"
    });
    expect(headers["x-6esk-tenant-timestamp"]).toBeTruthy();
    expect(headers["x-6esk-tenant-signature"]).toMatch(/^sha256=/);
    expect(
      tenantScopeFromMachineRequest(new Request(url, { method: "POST", headers }))
    ).toEqual({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
  });

  it("binds script signatures to the requested path and query", () => {
    const signedUrl = "http://localhost/api/admin/calls/outbox?limit=25";
    const replayUrl = "http://localhost/api/admin/calls/retry?limit=25";
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      TENANT_INGRESS_REQUIRE_SCOPE: "true",
      TENANT_INGRESS_REQUIRE_SIGNATURE: "true",
      TENANT_INGRESS_TENANT: "tenant-a",
      TENANT_INGRESS_WORKSPACE: "workspace-a",
      TENANT_INGRESS_SIGNING_SECRETS_JSON: JSON.stringify({
        "tenant-a:workspace-a": TENANT_INGRESS_SECRET
      })
    };

    const headers = tenantIngressHeaders({
      url: signedUrl,
      method: "POST",
      headers: { "x-6esk-secret": "calls-secret" }
    });

    expect(() =>
      tenantScopeFromMachineRequest(new Request(replayUrl, { method: "POST", headers }))
    ).toThrow("Tenant ingress signature is invalid.");
  });
});
