import { describe, expect, it } from "vitest";
import {
  normalizeCallPhone,
  resolveCallPhoneForRequest,
  type TicketCallOptions
} from "@/server/calls/service";

function buildOptions(overrides?: Partial<TicketCallOptions>): TicketCallOptions {
  return {
    ticketId: "11111111-1111-1111-1111-111111111111",
    selectionRequired: false,
    defaultCandidateId: "customer-primary",
    canManualDial: true,
    candidates: [
      {
        candidateId: "customer-primary",
        phone: "+15551234567",
        label: "Primary phone",
        source: "customer_primary",
        isPrimary: true
      }
    ],
    ...overrides
  };
}

describe("normalizeCallPhone", () => {
  it("normalizes and keeps valid phone content", () => {
    expect(normalizeCallPhone(" +1 (555) 123-4567 ")).toBe("+15551234567");
  });

  it("returns null for invalid short values", () => {
    expect(normalizeCallPhone("123")).toBeNull();
  });
});

describe("resolveCallPhoneForRequest", () => {
  it("uses manual phone when provided", () => {
    const result = resolveCallPhoneForRequest({
      options: buildOptions(),
      toPhone: "+1 555 765 4321"
    });

    expect(result).toMatchObject({
      status: "resolved",
      phone: "+15557654321"
    });
  });

  it("returns selection_required when options are ambiguous", () => {
    const options = buildOptions({
      selectionRequired: true,
      defaultCandidateId: null,
      candidates: [
        {
          candidateId: "primary",
          phone: "+15551234567",
          label: "Primary phone",
          source: "customer_primary",
          isPrimary: true
        },
        {
          candidateId: "secondary",
          phone: "+15557654321",
          label: "Secondary phone",
          source: "customer_identity",
          isPrimary: false
        }
      ]
    });

    const result = resolveCallPhoneForRequest({ options });

    expect(result.status).toBe("selection_required");
    if (result.status === "selection_required") {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it("returns failed when candidate id is unknown", () => {
    const result = resolveCallPhoneForRequest({
      options: buildOptions(),
      candidateId: "missing"
    });

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "invalid_candidate"
    });
  });
});
