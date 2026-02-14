import { describe, expect, it } from "vitest";
import { buildProfileMetadataPatch } from "@/server/integrations/prediction-profile";

describe("buildProfileMetadataPatch", () => {
  it("includes durationMs for matched lookups", () => {
    const patch = buildProfileMetadataPatch({
      status: "matched",
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

