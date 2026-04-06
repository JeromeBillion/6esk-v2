import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markVoiceOperatorQueueOutcome: vi.fn(),
  reserveNextVoiceDeskOperatorForCall: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  normalizeTwilioParams: vi.fn(),
  buildTwilioPublicUrl: vi.fn(),
  buildDeskOperatorDialTwiML: vi.fn(),
  buildHoldAndRetryTwiML: vi.fn(),
  buildUnavailableTwiML: vi.fn(),
  parseQueuedOperatorIds: vi.fn(),
  shouldContinueVoiceQueue: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/calls/operators", () => ({
  markVoiceOperatorQueueOutcome: mocks.markVoiceOperatorQueueOutcome,
  reserveNextVoiceDeskOperatorForCall: mocks.reserveNextVoiceDeskOperatorForCall
}));

vi.mock("@/server/calls/twilio", () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
  normalizeTwilioParams: mocks.normalizeTwilioParams,
  buildTwilioPublicUrl: mocks.buildTwilioPublicUrl
}));

vi.mock("@/server/calls/twilio-queue", () => ({
  buildDeskOperatorDialTwiML: mocks.buildDeskOperatorDialTwiML,
  buildHoldAndRetryTwiML: mocks.buildHoldAndRetryTwiML,
  buildUnavailableTwiML: mocks.buildUnavailableTwiML,
  buildVoiceResponse: (body: string) =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" }
    }),
  parseQueuedOperatorIds: mocks.parseQueuedOperatorIds,
  shouldContinueVoiceQueue: mocks.shouldContinueVoiceQueue
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/calls/webhooks/twilio/voice/queue/route";

describe("POST /api/calls/webhooks/twilio/voice/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.normalizeTwilioParams.mockImplementation((params: URLSearchParams) =>
      Object.fromEntries(params.entries())
    );
    mocks.validateTwilioWebhook.mockReturnValue(true);
    mocks.parseQueuedOperatorIds.mockReturnValue(["11111111-1111-1111-1111-111111111111"]);
    mocks.shouldContinueVoiceQueue.mockReturnValue(true);
    mocks.buildTwilioPublicUrl.mockReturnValue(
      "https://desk.example.com/api/calls/webhooks/twilio/recording"
    );
    mocks.reserveNextVoiceDeskOperatorForCall.mockResolvedValue({
      userId: "22222222-2222-2222-2222-222222222222",
      identity: "desk_user_22222222-2222-2222-2222-222222222222",
      displayName: "Olivia",
      email: "olivia@6ex.co.za",
      status: "online",
      activeCallSessionId: null,
      ringingCallSessionId: "call-session-1"
    });
    mocks.buildDeskOperatorDialTwiML.mockReturnValue(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Client><Identity>desk_user_22222222-2222-2222-2222-222222222222</Identity></Client></Dial></Response>`
    );
  });

  it("marks the previous operator outcome and rings the next operator in sequence", async () => {
    const body = new URLSearchParams({
      CallSid: "CA-parent-1",
      From: "+27810000000",
      To: "+16624398187",
      DialCallStatus: "no-answer"
    });

    const response = await POST(
      new Request(
        "https://desk.example.com/api/calls/webhooks/twilio/voice/queue?callSessionId=call-session-1&operatorUserId=11111111-1111-1111-1111-111111111111&attempt=0&offered=11111111-1111-1111-1111-111111111111",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-twilio-signature": "valid"
          },
          body
        }
      )
    );

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("desk_user_22222222-2222-2222-2222-222222222222");
    expect(mocks.markVoiceOperatorQueueOutcome).toHaveBeenCalledWith({
      userId: "11111111-1111-1111-1111-111111111111",
      callSessionId: "call-session-1",
      outcome: "missed"
    });
    expect(mocks.reserveNextVoiceDeskOperatorForCall).toHaveBeenCalledWith({
      callSessionId: "call-session-1",
      excludeUserIds: ["11111111-1111-1111-1111-111111111111"]
    });
    expect(mocks.buildDeskOperatorDialTwiML).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "call-session-1",
        offeredUserIds: [
          "11111111-1111-1111-1111-111111111111",
          "22222222-2222-2222-2222-222222222222"
        ],
        target: expect.objectContaining({
          identity: "desk_user_22222222-2222-2222-2222-222222222222"
        })
      })
    );
  });
});
