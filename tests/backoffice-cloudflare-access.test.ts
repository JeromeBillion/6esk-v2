import { describe, expect, it, vi } from "vitest";

vi.mock("jose/jwks/remote", () => ({
  createRemoteJWKSet: vi.fn(() => "jwks")
}));

vi.mock("jose/jwt/verify", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    if (token === "bad-jwt") {
      throw new Error("invalid signature");
    }
    return { payload: { email: token === "other-email-jwt" ? "other@6esk.com" : "ops@6esk.com" } };
  })
}));

import {
  checkCloudflareAccessHeaders,
  shouldRequireCloudflareAccess
} from "@6esk/auth/cloudflare-access";

describe("backoffice Cloudflare Access guard", () => {
  it("does not require Cloudflare Access outside production", () => {
    expect(
      shouldRequireCloudflareAccess({
        NODE_ENV: "development",
        BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });

  it("fails closed in production when Access config is incomplete", async () => {
    const result = await checkCloudflareAccessHeaders(new Headers(), {
      NODE_ENV: "production",
      BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS: "true",
      CLOUDFLARE_ACCESS_AUD: ""
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("requires Cloudflare Access identity headers in production", async () => {
    const result = await checkCloudflareAccessHeaders(new Headers(), {
      NODE_ENV: "production",
      BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS: "true",
      CLOUDFLARE_ACCESS_AUD: "audience",
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://6esk.cloudflareaccess.com"
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("accepts verified Cloudflare Access identity headers when enforcement is enabled", async () => {
    const headers = new Headers({
      "cf-access-authenticated-user-email": "ops@6esk.com",
      "cf-access-jwt-assertion": "jwt"
    });
    const result = await checkCloudflareAccessHeaders(headers, {
      NODE_ENV: "production",
      BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS: "true",
      CLOUDFLARE_ACCESS_AUD: "audience",
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://6esk.cloudflareaccess.com"
    } as NodeJS.ProcessEnv);

    expect(result).toEqual({
      ok: true,
      email: "ops@6esk.com",
      assertion: "jwt"
    });
  });

  it("rejects Access JWTs that fail signature or claim verification", async () => {
    const headers = new Headers({
      "cf-access-authenticated-user-email": "ops@6esk.com",
      "cf-access-jwt-assertion": "bad-jwt"
    });
    const result = await checkCloudflareAccessHeaders(headers, {
      NODE_ENV: "production",
      BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS: "true",
      CLOUDFLARE_ACCESS_AUD: "audience",
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://6esk.cloudflareaccess.com"
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects mismatched email evidence between Access header and token", async () => {
    const headers = new Headers({
      "cf-access-authenticated-user-email": "ops@6esk.com",
      "cf-access-jwt-assertion": "other-email-jwt"
    });
    const result = await checkCloudflareAccessHeaders(headers, {
      NODE_ENV: "production",
      BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS: "true",
      CLOUDFLARE_ACCESS_AUD: "audience",
      CLOUDFLARE_ACCESS_TEAM_DOMAIN: "https://6esk.cloudflareaccess.com"
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});
