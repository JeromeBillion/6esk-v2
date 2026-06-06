import { describe, expect, it } from "vitest";
import {
  buildExternalProfileMetadataPatch,
  enrichExternalProfileMetadata,
  readExternalProfileFromMetadata,
  readExternalProfileMatchedBy,
  readExternalProfileSource
} from "@/server/integrations/external-profile";

describe("external profile helpers", () => {
  it("enriches authenticated webchat metadata with the white-label source", () => {
    const enriched = enrichExternalProfileMetadata({
      isAuthenticated: true,
      appUserId: "user-123",
      appUserEmail: "Olivia.Parker@Example.com",
      appUserFullName: "Olivia Parker",
      appUserPhone: "+27 82 123 4567"
    });

    expect(enriched).toMatchObject({
      external_profile: {
        source: "white-label-webchat",
        externalUserId: "user-123",
        matchedBy: "session_auth",
        fullName: "Olivia Parker",
        email: "Olivia.Parker@Example.com",
        phoneNumber: "+27 82 123 4567"
      },
      profile_lookup: {
        source: "white-label-webchat",
        status: "matched",
        matchedBy: "session_auth"
      }
    });
  });

  it("reads explicit tenant plugin profile metadata", () => {
    const metadata = {
      external_profile: {
        source: "Customer Profile Plug",
        externalUserId: "ext-1",
        email: "customer@example.com",
        phoneNumber: "+27710000001"
      },
      profile_lookup: {
        matchedBy: "email"
      }
    };

    expect(readExternalProfileFromMetadata(metadata)).toEqual({
      id: "ext-1",
      email: "customer@example.com",
      secondaryEmail: null,
      fullName: null,
      phoneNumber: "+27710000001",
      kycStatus: null,
      accountStatus: null
    });
    expect(readExternalProfileSource(metadata)).toBe("customer-profile-plug");
    expect(readExternalProfileMatchedBy(metadata)).toBe("email");
  });

  it("adds profile lookup metadata when a plug only supplies external_profile", () => {
    const enriched = enrichExternalProfileMetadata({
      external_profile: {
        source: "CRM Profile Plugin",
        externalUserId: "ext-2",
        email: "customer@example.com",
        matchedBy: "email",
        matchedAt: "2026-06-02T10:00:00.000Z"
      }
    });

    expect(enriched).toMatchObject({
      profile_lookup: {
        source: "crm-profile-plugin",
        status: "matched",
        matchedBy: "email",
        lookupAt: "2026-06-02T10:00:00.000Z"
      }
    });
  });

  it("builds matched profile metadata without an upstream lookup dependency", () => {
    const patch = buildExternalProfileMetadataPatch({
      source: "crm-profile-plugin",
      matchedBy: "phone",
      matchedAt: "2026-06-02T10:00:00.000Z",
      profile: {
        id: "ext-2",
        phoneNumber: "+27710000002",
        fullName: "Maya Naidoo"
      }
    });

    expect(patch).toMatchObject({
      profile_lookup: {
        source: "crm-profile-plugin",
        status: "matched",
        matchedBy: "phone",
        lookupAt: "2026-06-02T10:00:00.000Z"
      },
      external_profile: {
        source: "crm-profile-plugin",
        externalUserId: "ext-2",
        matchedBy: "phone",
        matchedAt: "2026-06-02T10:00:00.000Z",
        fullName: "Maya Naidoo",
        phoneNumber: "+27710000002"
      }
    });
  });
});
