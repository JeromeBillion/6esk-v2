import { describe, expect, it } from "vitest";
import { evaluateVoiceCallPolicy } from "@/server/calls/policy";

describe("evaluateVoiceCallPolicy consent handling", () => {
  it("blocks when consent state is revoked even if require_consent is false", async () => {
    const result = await evaluateVoiceCallPolicy({
      actor: "human",
      policy: { voice: { require_consent: false } },
      consentState: {
        state: "revoked",
        callbackPhone: "+15551234567",
        termsVersion: "v2.3",
        source: "help_center_self_service",
        updatedAt: "2026-02-19T10:00:00.000Z",
        identityType: "phone",
        identityValue: "+15551234567",
        customerId: "customer-1"
      }
    });

    expect(result).toMatchObject({
      allowed: false,
      code: "consent_required"
    });
  });

  it("allows when require_consent is true and latest consent state is granted", async () => {
    const result = await evaluateVoiceCallPolicy({
      actor: "human",
      policy: { voice: { require_consent: true } },
      ticketMetadata: {},
      consentState: {
        state: "granted",
        callbackPhone: "+15551234567",
        termsVersion: "v2.3",
        source: "trusted_api",
        updatedAt: "2026-02-19T10:00:00.000Z",
        identityType: "phone",
        identityValue: "+15551234567",
        customerId: "customer-1"
      }
    });

    expect(result).toEqual({ allowed: true });
  });
});
