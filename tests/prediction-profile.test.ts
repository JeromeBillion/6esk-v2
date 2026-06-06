import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findExternalUserLinkByIdentity: vi.fn()
}));

vi.mock("@/server/integrations/external-user-links", () => ({
  findExternalUserLinkByIdentity: mocks.findExternalUserLinkByIdentity
}));

import {
  buildProfileMetadataPatch,
  lookupPredictionProfile
} from "@/server/integrations/prediction-profile";

const ORIGINAL_ENV = { ...process.env };

function applyLookupEnv() {
  process.env.PREDICTION_PROFILE_LOOKUP_ENABLED = "true";
  process.env.PREDICTION_PROFILE_LOOKUP_URL = "https://prediction.example.com";
  process.env.PREDICTION_PROFILE_LOOKUP_SECRET = "test-secret";
  process.env.PREDICTION_PROFILE_LOOKUP_TIMEOUT_MS = "200";
  process.env.PREDICTION_PROFILE_LOOKUP_RETRY_COUNT = "0";
}

describe("buildProfileMetadataPatch", () => {
  it("includes durationMs for matched lookups", () => {
    const patch = buildProfileMetadataPatch({
      status: "matched",
      source: "prediction-market-mvp",
      matchedBy: "email",
      durationMs: 123,
      profile: {
        id: "user-1",
        email: "user@example.com",
        secondaryEmail: null,
        fullName: "Example User",
        phoneNumber: "+27710000001",
        kycStatus: "verified",
        accountStatus: "active"
      }
    });

    const profileLookup = patch.profile_lookup as Record<string, unknown>;
    expect(profileLookup.status).toBe("matched");
    expect(profileLookup.durationMs).toBe(123);
    expect(profileLookup.matchedBy).toBe("email");
  });

  it("includes durationMs and error details for errored lookups", () => {
    const patch = buildProfileMetadataPatch({
      status: "error",
      error: "timeout",
      durationMs: 1501
    });

    const profileLookup = patch.profile_lookup as Record<string, unknown>;
    expect(profileLookup.status).toBe("error");
    expect(profileLookup.error).toBe("timeout");
    expect(profileLookup.durationMs).toBe(1501);
  });

  it("includes durationMs for missed and disabled lookups", () => {
    const missedPatch = buildProfileMetadataPatch({ status: "missed", durationMs: 7 });
    const disabledPatch = buildProfileMetadataPatch({ status: "disabled", durationMs: 0 });

    expect((missedPatch.profile_lookup as Record<string, unknown>).durationMs).toBe(7);
    expect((disabledPatch.profile_lookup as Record<string, unknown>).durationMs).toBe(0);
  });
});

describe("lookupPredictionProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyLookupEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("falls back to cached external_user_links when live lookup misses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          matched: false
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.findExternalUserLinkByIdentity.mockResolvedValue({
      external_system: "prediction-market-mvp",
      external_user_id: "cached-user-1",
      email: "user@example.com",
      phone: "+27710000001",
      matched_by: "email",
      confidence: 1,
      last_seen_at: new Date().toISOString(),
      last_ticket_id: null,
      last_channel: "email"
    });

    const result = await lookupPredictionProfile({
      email: "  USER@example.com "
    });

    expect(result).toMatchObject({
      status: "matched",
      source: "prediction-market-mvp-cache",
      matchedBy: "email"
    });
    if (result.status === "matched") {
      expect(result.profile).toMatchObject({
        id: "cached-user-1",
        email: "user@example.com"
      });
    }
    expect(mocks.findExternalUserLinkByIdentity).toHaveBeenCalledWith({
      externalSystem: "prediction-market-mvp",
      email: "user@example.com",
      phone: null
    });
  });

  it("falls back to cached external_user_links when live lookup times out", async () => {
    const timeoutError = new Error("The operation was aborted.");
    timeoutError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(timeoutError);
    vi.stubGlobal("fetch", fetchMock);
    mocks.findExternalUserLinkByIdentity.mockResolvedValue({
      external_system: "prediction-market-mvp",
      external_user_id: "cached-user-2",
      email: "phone-user@example.com",
      phone: "+27715550000",
      matched_by: "phone_number",
      confidence: 1,
      last_seen_at: new Date().toISOString(),
      last_ticket_id: null,
      last_channel: "whatsapp"
    });

    const result = await lookupPredictionProfile({
      phone: "+27 71 555 0000"
    });

    expect(result).toMatchObject({
      status: "matched",
      source: "prediction-market-mvp-cache",
      matchedBy: "phone_number"
    });
    expect(mocks.findExternalUserLinkByIdentity).toHaveBeenCalledWith({
      externalSystem: "prediction-market-mvp",
      email: null,
      phone: "+27715550000"
    });
  });

  it("returns live matched payload and skips cache when lookup succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          matched: true,
          matchedBy: "email",
          user: {
            id: "live-user-1",
            email: "live@example.com",
            full_name: "Live User"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupPredictionProfile({
      email: "live@example.com"
    });

    expect(result).toMatchObject({
      status: "matched",
      source: "prediction-market-mvp",
      matchedBy: "email"
    });
    expect(mocks.findExternalUserLinkByIdentity).not.toHaveBeenCalled();
  });
});
