import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attachCallRecording: vi.fn(),
  recordAuditLog: vi.fn(),
  twilioFactory: vi.fn(),
  twilioValidate: vi.fn()
}));

vi.mock("@/server/calls/service", () => ({
  attachCallRecording: mocks.attachCallRecording
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

import { GET } from "@/app/api/calls/webhooks/twilio/recording/route";

const ORIGINAL_ENV = { ...process.env };

describe("GET /api/calls/webhooks/twilio/recording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      APP_URL: "https://app.6esk.test",
      CALLS_TWILIO_ACCOUNT_SID: "AC123",
      CALLS_TWILIO_AUTH_TOKEN: "auth-token"
    };
    mocks.attachCallRecording.mockResolvedValue({
      status: "attached",
      callSessionId: "call-session-1",
      recordingUrl: "/api/attachments/a?disposition=inline",
      recordingR2Key: "messages/message-1/recording.mp3"
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.twilioValidate.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts Twilio recording callbacks directly in 6esk", async () => {
    const response = await GET(
      new Request(
        "https://app.6esk.test/api/calls/webhooks/twilio/recording?CallSid=CA123&RecordingSid=RE123&RecordingUrl=https://api.twilio.com/recordings/RE123&RecordingDuration=44&Timestamp=1710000000",
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
      status: "attached",
      callSessionId: "call-session-1"
    });
    expect(mocks.attachCallRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twilio",
        providerCallId: "CA123",
        recordingUrl: "https://api.twilio.com/recordings/RE123"
      })
    );
    expect(mocks.twilioValidate).toHaveBeenCalledWith(
      "auth-token",
      "sig",
      "https://app.6esk.test/api/calls/webhooks/twilio/recording?CallSid=CA123&RecordingSid=RE123&RecordingUrl=https://api.twilio.com/recordings/RE123&RecordingDuration=44&Timestamp=1710000000",
      {}
    );
  });
});
