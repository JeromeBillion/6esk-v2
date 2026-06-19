import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findExternalUserLinkByIdentity: vi.fn()
}));

vi.mock("@/server/integrations/external-user-links", () => ({
  findExternalUserLinkByIdentity: mocks.findExternalUserLinkByIdentity
}));

import {
  buildExternalProfileMetadataPatch,
  lookupExternalProfile
} from "@/server/integrations/external-profile";

const ORIGINAL_ENV = { ...process.env };
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

function applyLookupEnv() {
  process.env.EXTERNAL_PROFILE_LOOKUP_ENABLED = "true";
  process.env.EXTERNAL_PROFILE_LOOKUP_URL = "https://profiles.example.com";
  process.env.EXTERNAL_PROFILE_LOOKUP_SECRET = "test-secret";
  process.env.EXTERNAL_PROFILE_LOOKUP_TIMEOUT_MS = "200";
  process.env.EXTERNAL_PROFILE_LOOKUP_RETRY_COUNT = "0";
}

describe("buildExternalProfileMetadataPatch", () => {
  it("includes durationMs for matched lookups", () => {
    const patch = buildExternalProfileMetadataPatch({
      status: "matched",
      source: "external-profile",
      externalSystem: "external-profile",
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
    const patch = buildExternalProfileMetadataPatch({
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
    const missedPatch = buildExternalProfileMetadataPatch({ status: "missed", durationMs: 7 });
    const disabledPatch = buildExternalProfileMetadataPatch({ status: "disabled", durationMs: 0 });

    expect((missedPatch.profile_lookup as Record<string, unknown>).durationMs).toBe(7);
    expect((disabledPatch.profile_lookup as Record<string, unknown>).durationMs).toBe(0);
  });
});

describe("lookupExternalProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyLookupEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects lookups without tenant scope before network or cache access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      lookupExternalProfile({
        tenantId: "",
        email: "user@example.com"
      })
    ).rejects.toThrow("tenantId is required");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.findExternalUserLinkByIdentity).not.toHaveBeenCalled();
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
      external_system: "external-profile",
      external_user_id: "cached-user-1",
      email: "user@example.com",
      phone: "+27710000001",
      matched_by: "email",
      confidence: 1,
      last_seen_at: new Date().toISOString(),
      last_ticket_id: null,
      last_channel: "email"
    });

    const result = await lookupExternalProfile({
      tenantId: TENANT_ID,
      email: "  USER@example.com "
    });

    expect(result).toMatchObject({
      status: "matched",
      source: "external-profile-cache",
      externalSystem: "external-profile",
      matchedBy: "email"
    });
    if (result.status === "matched") {
      expect(result.profile).toMatchObject({
        id: "cached-user-1",
        email: "user@example.com"
      });
    }
    expect(mocks.findExternalUserLinkByIdentity).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      externalSystem: "external-profile",
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
      external_system: "external-profile",
      external_user_id: "cached-user-2",
      email: "phone-user@example.com",
      phone: "+27715550000",
      matched_by: "phone_number",
      confidence: 1,
      last_seen_at: new Date().toISOString(),
      last_ticket_id: null,
      last_channel: "whatsapp"
    });

    const result = await lookupExternalProfile({
      tenantId: TENANT_ID,
      phone: "+27 71 555 0000"
    });

    expect(result).toMatchObject({
      status: "matched",
      source: "external-profile-cache",
      externalSystem: "external-profile",
      matchedBy: "phone_number"
    });
    expect(mocks.findExternalUserLinkByIdentity).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      externalSystem: "external-profile",
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

    const result = await lookupExternalProfile({
      tenantId: TENANT_ID,
      email: "live@example.com"
    });

    expect(result).toMatchObject({
      status: "matched",
      source: "external-profile",
      externalSystem: "external-profile",
      matchedBy: "email"
    });
    expect(mocks.findExternalUserLinkByIdentity).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-6esk-tenant-id": TENANT_ID
        })
      })
    );
  });
});
