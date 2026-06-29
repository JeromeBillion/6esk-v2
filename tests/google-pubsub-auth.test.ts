import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jwtVerify: vi.fn()
}));

vi.mock("jose/jwks/remote", () => ({
  createRemoteJWKSet: vi.fn(() => "jwks")
}));

vi.mock("jose/jwt/verify", () => ({
  jwtVerify: mocks.jwtVerify
}));

import {
  checkGooglePubSubPushHeaders,
  checkGooglePubSubSubscription,
  shouldRequireGooglePubSubPushAuth
} from "@6esk/auth/google-pubsub";

describe("Google Pub/Sub push auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not require a bearer token outside production unless explicitly enabled", async () => {
    const result = await checkGooglePubSubPushHeaders(new Headers(), {
      NODE_ENV: "development",
      GOOGLE_PUBSUB_REQUIRE_AUTH: "false"
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(true);
    expect(mocks.jwtVerify).not.toHaveBeenCalled();
    expect(
      shouldRequireGooglePubSubPushAuth({
        NODE_ENV: "development",
        GOOGLE_PUBSUB_REQUIRE_AUTH: "true"
      } as NodeJS.ProcessEnv)
    ).toBe(true);
  });

  it("fails closed in production when push auth config is incomplete", async () => {
    const result = await checkGooglePubSubPushHeaders(new Headers(), {
      NODE_ENV: "production",
      GOOGLE_PUBSUB_PUSH_AUDIENCE: ""
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("requires a bearer token in production", async () => {
    const result = await checkGooglePubSubPushHeaders(new Headers(), {
      NODE_ENV: "production",
      GOOGLE_PUBSUB_PUSH_AUDIENCE: "https://app.example.com/api/oauth/webhooks/google"
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("accepts verified Google-issued Pub/Sub push tokens", async () => {
    mocks.jwtVerify.mockResolvedValueOnce({
      payload: {
        iss: "https://accounts.google.com",
        email: "pubsub-push@project.iam.gserviceaccount.com",
        email_verified: true,
        sub: "service-account-subject"
      }
    });

    const result = await checkGooglePubSubPushHeaders(
      new Headers({ authorization: "Bearer good-jwt" }),
      {
        NODE_ENV: "production",
        GOOGLE_PUBSUB_PUSH_AUDIENCE: "https://app.example.com/api/oauth/webhooks/google",
        GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL: "pubsub-push@project.iam.gserviceaccount.com"
      } as NodeJS.ProcessEnv
    );

    expect(result).toEqual({
      ok: true,
      tokenEmail: "pubsub-push@project.iam.gserviceaccount.com",
      tokenSubject: "service-account-subject"
    });
    expect(mocks.jwtVerify).toHaveBeenCalledWith("good-jwt", expect.anything(), {
      audience: "https://app.example.com/api/oauth/webhooks/google"
    });
  });

  it("rejects mismatched service-account identity evidence", async () => {
    mocks.jwtVerify.mockResolvedValueOnce({
      payload: {
        iss: "https://accounts.google.com",
        email: "other@project.iam.gserviceaccount.com",
        email_verified: true
      }
    });

    const result = await checkGooglePubSubPushHeaders(
      new Headers({ authorization: "Bearer other-jwt" }),
      {
        NODE_ENV: "production",
        GOOGLE_PUBSUB_PUSH_AUDIENCE: "https://app.example.com/api/oauth/webhooks/google",
        GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL: "pubsub-push@project.iam.gserviceaccount.com"
      } as NodeJS.ProcessEnv
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects untrusted issuers and invalid token verification", async () => {
    mocks.jwtVerify.mockResolvedValueOnce({
      payload: {
        iss: "https://evil.example",
        email: "pubsub-push@project.iam.gserviceaccount.com"
      }
    });

    const untrustedIssuer = await checkGooglePubSubPushHeaders(
      new Headers({ authorization: "Bearer issuer-jwt" }),
      {
        NODE_ENV: "production",
        GOOGLE_PUBSUB_PUSH_AUDIENCE: "https://app.example.com/api/oauth/webhooks/google"
      } as NodeJS.ProcessEnv
    );

    mocks.jwtVerify.mockRejectedValueOnce(new Error("invalid signature"));
    const invalidSignature = await checkGooglePubSubPushHeaders(
      new Headers({ authorization: "Bearer bad-jwt" }),
      {
        NODE_ENV: "production",
        GOOGLE_PUBSUB_PUSH_AUDIENCE: "https://app.example.com/api/oauth/webhooks/google"
      } as NodeJS.ProcessEnv
    );

    expect(untrustedIssuer.ok).toBe(false);
    expect(untrustedIssuer.status).toBe(403);
    expect(invalidSignature.ok).toBe(false);
    expect(invalidSignature.status).toBe(403);
  });

  it("rejects unexpected Pub/Sub subscriptions when configured", () => {
    const env = {
      GOOGLE_PUBSUB_SUBSCRIPTION: "projects/project-id/subscriptions/gmail-events"
    } as NodeJS.ProcessEnv;

    expect(checkGooglePubSubSubscription("projects/project-id/subscriptions/gmail-events", env).ok).toBe(true);

    const result = checkGooglePubSubSubscription("projects/other/subscriptions/gmail-events", env);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });
});
