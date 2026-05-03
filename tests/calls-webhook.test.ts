import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeCallWebhook, buildCallWebhookSignature } from "@/server/calls/webhook";

const ORIGINAL_ENV = { ...process.env };

describe("call webhook authorization", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.INBOUND_SHARED_SECRET;
    delete process.env.CALLS_WEBHOOK_SECRET;
    delete process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS;
    delete process.env.CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE;
    delete process.env.CALLS_WEBHOOK_ALLOW_UNAUTHENTICATED;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("authorizes signed payloads within replay window", () => {
    process.env.CALLS_WEBHOOK_SECRET = "voice-secret";
    process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS = "300";

    const rawBody = JSON.stringify({ providerCallId: "abc", status: "ringing" });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = buildCallWebhookSignature(rawBody, "voice-secret", timestamp);

    const result = authorizeCallWebhook({
      rawBody,
      providedSignature: signature,
      providedTimestamp: timestamp,
      providedSecret: null
    });

    expect(result).toEqual({
      authorized: true,
      mode: "hmac",
      reason: "ok"
    });
  });

  it("rejects signed payloads without timestamp when replay checks are enabled", () => {
    process.env.CALLS_WEBHOOK_SECRET = "voice-secret";
    process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS = "300";

    const rawBody = JSON.stringify({ providerCallId: "abc", status: "ringing" });
    const signature = buildCallWebhookSignature(rawBody, "voice-secret");

    const result = authorizeCallWebhook({
      rawBody,
      providedSignature: signature,
      providedTimestamp: null,
      providedSecret: null
    });

    expect(result).toEqual({
      authorized: false,
      mode: "hmac",
      reason: "missing_timestamp"
    });
  });

  it("rejects stale signed payloads outside replay window", () => {
    process.env.CALLS_WEBHOOK_SECRET = "voice-secret";
    process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS = "300";

    const rawBody = JSON.stringify({ providerCallId: "abc", status: "ringing" });
    const staleTimestamp = Math.floor(Date.now() / 1000 - 3600).toString();
    const signature = buildCallWebhookSignature(rawBody, "voice-secret", staleTimestamp);

    const result = authorizeCallWebhook({
      rawBody,
      providedSignature: signature,
      providedTimestamp: staleTimestamp,
      providedSecret: null
    });

    expect(result).toEqual({
      authorized: false,
      mode: "hmac",
      reason: "timestamp_out_of_window"
    });
  });

  it("rejects when timestamp is modified after signing", () => {
    process.env.CALLS_WEBHOOK_SECRET = "voice-secret";
    process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS = "300";

    const rawBody = JSON.stringify({ providerCallId: "abc", status: "ringing" });
    const signedTimestamp = Math.floor(Date.now() / 1000).toString();
    const tamperedTimestamp = Math.floor(Date.now() / 1000 + 60).toString();
    const signature = buildCallWebhookSignature(rawBody, "voice-secret", signedTimestamp);

    const result = authorizeCallWebhook({
      rawBody,
      providedSignature: signature,
      providedTimestamp: tamperedTimestamp,
      providedSecret: null
    });

    expect(result).toEqual({
      authorized: false,
      mode: "hmac",
      reason: "invalid_signature"
    });
  });

  it("supports temporary legacy body-only signatures when explicitly enabled", () => {
    process.env.CALLS_WEBHOOK_SECRET = "voice-secret";
    process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS = "300";
    process.env.CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE = "true";

    const rawBody = JSON.stringify({ providerCallId: "abc", status: "ringing" });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = buildCallWebhookSignature(rawBody, "voice-secret");

    const result = authorizeCallWebhook({
      rawBody,
      providedSignature: signature,
      providedTimestamp: timestamp,
      providedSecret: null
    });

    expect(result).toEqual({
      authorized: true,
      mode: "hmac",
      reason: "ok"
    });
  });

  it("falls back to shared-secret authorization when hmac secret is not configured", () => {
    process.env.INBOUND_SHARED_SECRET = "inbound-secret";

    const result = authorizeCallWebhook({
      rawBody: "{}",
      providedSignature: null,
      providedTimestamp: null,
      providedSecret: "inbound-secret"
    });

    expect(result).toEqual({
      authorized: true,
      mode: "shared_secret",
      reason: "ok"
    });
  });

  it("fails closed in production when no webhook secret is configured", () => {
    process.env.NODE_ENV = "production";

    const result = authorizeCallWebhook({
      rawBody: "{}",
      providedSignature: null,
      providedTimestamp: null,
      providedSecret: null
    });

    expect(result).toEqual({
      authorized: false,
      mode: "open",
      reason: "unsecured_mode"
    });
  });
});
