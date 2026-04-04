import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrUpdateInboundCall: vi.fn(),
  listAvailableVoiceDeskOperators: vi.fn(),
  validateTwilioWebhook: vi.fn(),
  normalizeTwilioParams: vi.fn(),
  buildTwilioDialTwiML: vi.fn(),
  buildTwilioPublicUrl: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/calls/service", () => ({
  createOrUpdateInboundCall: mocks.createOrUpdateInboundCall
}));

vi.mock("@/server/calls/operators", () => ({
  listAvailableVoiceDeskOperators: mocks.listAvailableVoiceDeskOperators
}));

vi.mock("@/server/calls/twilio", () => ({
  validateTwilioWebhook: mocks.validateTwilioWebhook,
  normalizeTwilioParams: mocks.normalizeTwilioParams,
  buildTwilioDialTwiML: mocks.buildTwilioDialTwiML,
  buildTwilioPublicUrl: mocks.buildTwilioPublicUrl
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/calls/webhooks/twilio/voice/route";

describe("POST /api/calls/webhooks/twilio/voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.normalizeTwilioParams.mockImplementation((params: URLSearchParams) =>
      Object.fromEntries(params.entries())
    );
    mocks.validateTwilioWebhook.mockReturnValue(true);
    mocks.createOrUpdateInboundCall.mockResolvedValue({
      status: "created",
      callSessionId: "call-session-1",
      ticketId: "ticket-1",
      messageId: "message-1",
      createdTicket: true
    });
    mocks.listAvailableVoiceDeskOperators.mockResolvedValue([
      {
        userId: "user-1",
        identity: "desk_user_user-1",
        displayName: "Jerome",
        email: "jerome@6ex.co.za",
        status: "online",
        activeCallSessionId: null
      }
    ]);
    mocks.buildTwilioPublicUrl.mockReturnValue(
      "https://desk.example.com/api/calls/webhooks/twilio/recording"
    );
    mocks.buildTwilioDialTwiML.mockReturnValue(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Client><Identity>desk_user_user-1</Identity></Client></Dial></Response>`
    );
  });

  it("creates an inbound call session and returns TwiML that rings desk clients", async () => {
    const body = new URLSearchParams({
      CallSid: "CA-inbound-1",
      From: "+27810000000",
      To: "+16624398187",
      Direction: "inbound"
    });

    const response = await POST(
      new Request("https://desk.example.com/api/calls/webhooks/twilio/voice", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": "valid"
        },
        body
      })
    );

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain("<Identity>desk_user_user-1</Identity>");
    expect(mocks.createOrUpdateInboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "twilio",
        providerCallId: "CA-inbound-1",
        fromPhone: "+27810000000",
        toPhone: "+16624398187",
        status: "ringing"
      })
    );
    expect(mocks.buildTwilioDialTwiML).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({
            type: "client",
            identity: "desk_user_user-1"
          })
        ]
      })
    );
  });
});
