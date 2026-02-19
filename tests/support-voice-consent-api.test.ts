import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canManageTickets: vi.fn(),
  normalizeVoiceConsentEmail: vi.fn(),
  normalizeVoiceConsentPhone: vi.fn(),
  recordVoiceConsentEvent: vi.fn(),
  resolveExistingCustomerIdForVoiceConsent: vi.fn(),
  getLatestVoiceConsentState: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  canManageTickets: mocks.canManageTickets
}));

vi.mock("@/server/calls/consent", () => ({
  normalizeVoiceConsentEmail: mocks.normalizeVoiceConsentEmail,
  normalizeVoiceConsentPhone: mocks.normalizeVoiceConsentPhone,
  recordVoiceConsentEvent: mocks.recordVoiceConsentEvent,
  resolveExistingCustomerIdForVoiceConsent: mocks.resolveExistingCustomerIdForVoiceConsent,
  getLatestVoiceConsentState: mocks.getLatestVoiceConsentState
}));

import { POST } from "@/app/api/support/voice-consent/route";

describe("POST /api/support/voice-consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.canManageTickets.mockReturnValue(false);
    mocks.normalizeVoiceConsentEmail.mockImplementation((value: string | null) => value);
    mocks.normalizeVoiceConsentPhone.mockImplementation((value: string | null) => value);
    mocks.resolveExistingCustomerIdForVoiceConsent.mockResolvedValue("customer-1");
    mocks.recordVoiceConsentEvent.mockResolvedValue(undefined);
    mocks.getLatestVoiceConsentState.mockResolvedValue({
      state: "revoked",
      callbackPhone: "+15551234567",
      termsVersion: "v2.3",
      source: "help_center_self_service",
      updatedAt: "2026-02-19T10:00:00.000Z",
      identityType: "phone",
      identityValue: "+15551234567",
      customerId: "customer-1"
    });
  });

  it("allows public revoke requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/support/voice-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "revoke",
          phone: "+15551234567"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "updated",
      action: "revoke",
      consent: {
        state: "revoked"
      }
    });
    expect(mocks.recordVoiceConsentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "revoked",
        customerId: "customer-1"
      })
    );
  });

  it("blocks public grant requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/support/voice-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "grant",
          phone: "+15551234567"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      error: "Granting consent requires authenticated support access."
    });
    expect(mocks.recordVoiceConsentEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when no identity is provided", async () => {
    mocks.normalizeVoiceConsentEmail.mockReturnValue(null);
    mocks.normalizeVoiceConsentPhone.mockReturnValue(null);

    const response = await POST(
      new Request("http://localhost/api/support/voice-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "revoke",
          email: null,
          phone: null
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "At least one valid email or phone value is required."
    });
  });
});
