import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateCallSessionStatus: vi.fn(),
  recordAuditLog: vi.fn(),
  twilioFactory: vi.fn(),
  twilioValidate: vi.fn()
}));

vi.mock("@/server/calls/service", () => ({
  updateCallSessionStatus: mocks.updateCallSessionStatus
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("twilio", () => {
  const callable = ((...args: unknown[]) => mocks.twilioFactory(...args)) as ((
    ...args: unknown[]
  ) => unknown) & { validateRequest: (...args: unknown[]) => unknown };
  callable.validateRequest = (...args: unknown[]) => mocks.twilioValidate(...args);
  return { default: callable };
});

import { GET } from "@/app/api/calls/webhooks/twilio/status/route";

const ORIGINAL_ENV = { ...process.env };

describe("GET /api/calls/webhooks/twilio/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      APP_URL: "https://app.6esk.test",
      CALLS_TWILIO_ACCOUNT_SID: "AC123",
      CALLS_TWILIO_AUTH_TOKEN: "auth-token"
    };
    mocks.updateCallSessionStatus.mockResolvedValue({
      status: "updated",
      callSessionId: "call-session-1",
      previousStatus: "dialing",
      currentStatus: "ringing",
      ticketId: "ticket-1",
      mailboxId: "mailbox-1",
      messageId: "message-1"
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.twilioValidate.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts Twilio callbacks directly in 6esk", async () => {
    const response = await GET(
      new Request(
        "https://app.6esk.test/api/calls/webhooks/twilio/status?CallSid=CA123&CallStatus=ringing&CallDuration=12&Timestamp=1710000000",
        {
          headers: {
            "x-twilio-signature": "sig"
          }
        }
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "updated",
      callSessionId: "call-session-1"
    });
    expect(mocks.twilioValidate).toHaveBeenCalledWith(
      "auth-token",
      "sig",
      "https://app.6esk.test/api/calls/webhooks/twilio/status?CallSid=CA123&CallStatus=ringing&CallDuration=12&Timestamp=1710000000",
      {}
    );
    expect(mocks.updateCallSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twilio",
        providerCallId: "CA123",
        status: "ringing"
      })
    );
  });
});
