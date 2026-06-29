import { createRequire } from "module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildSecurityHeaders,
  securityHeaderRules,
  serializeContentSecurityPolicy
} = require("../packages/security-headers");
const webConfig = require("../next.config.js");
const backofficeConfig = require("../apps/backoffice/next.config.js");

function headerMap(headers: Array<{ key: string; value: string }>) {
  return new Map(headers.map((header) => [header.key.toLowerCase(), header.value]));
}

describe("security headers", () => {
  it("emits a restrictive baseline CSP without blocking packaged browser calls", () => {
    const policy = serializeContentSecurityPolicy();

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("connect-src 'self' https: wss:");
    expect(policy).toContain("media-src 'self' blob: data: https:");
  });

  it("includes HSTS only when the production header set is requested", () => {
    const developmentHeaders = headerMap(buildSecurityHeaders({ includeHsts: false }));
    const productionHeaders = headerMap(buildSecurityHeaders({ includeHsts: true }));

    expect(developmentHeaders.has("strict-transport-security")).toBe(false);
    expect(productionHeaders.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
  });

  it("protects all routes with browser hardening headers", () => {
    const [{ source, headers }] = securityHeaderRules({ includeHsts: true });
    const headersByName = headerMap(headers);

    expect(source).toBe("/:path*");
    expect(headersByName.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(headersByName.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headersByName.get("x-content-type-options")).toBe("nosniff");
    expect(headersByName.get("x-frame-options")).toBe("DENY");
    expect(headersByName.get("permissions-policy")).toContain("microphone=(self)");
  });

  it("wires the same header rule into web and backoffice Next configs", async () => {
    const [webRule] = await webConfig.headers();
    const [backofficeRule] = await backofficeConfig.headers();

    expect(webRule.source).toBe("/:path*");
    expect(backofficeRule.source).toBe("/:path*");
    expect(headerMap(webRule.headers).get("content-security-policy")).toBe(
      headerMap(backofficeRule.headers).get("content-security-policy")
    );
  });
});
