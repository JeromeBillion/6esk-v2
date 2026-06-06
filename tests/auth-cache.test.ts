import { describe, expect, it } from "vitest";
import { resolveAuthCacheConfig } from "@/server/auth/cache";

describe("auth cache config", () => {
  it("keeps local password auth cache optional", () => {
    expect(
      resolveAuthCacheConfig({
        NODE_ENV: "development",
        AUTH_PROVIDER: "password",
        AUTH_CACHE_PROVIDER: "none"
      })
    ).toEqual({ provider: "none", required: false });
  });

  it("marks cache required for production OAuth", () => {
    expect(
      resolveAuthCacheConfig({
        NODE_ENV: "production",
        AUTH_PROVIDER: "better_auth",
        AUTH_OAUTH_ENABLED: "true",
        AUTH_CACHE_PROVIDER: "upstash",
        UPSTASH_REDIS_REST_URL: "https://redis.example.com",
        UPSTASH_REDIS_REST_TOKEN: "token"
      })
    ).toEqual({
      provider: "upstash",
      required: true,
      restUrl: "https://redis.example.com",
      restToken: "token"
    });
  });

  it("supports Valkey as the open-source Redis-compatible cache target", () => {
    expect(
      resolveAuthCacheConfig({
        NODE_ENV: "production",
        AUTH_PROVIDER: "better_auth",
        AUTH_CACHE_PROVIDER: "valkey",
        AUTH_REDIS_URL: "redis://valkey.internal:6379"
      })
    ).toEqual({
      provider: "valkey",
      required: true,
      url: "redis://valkey.internal:6379"
    });
  });
});
