import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  putObject: vi.fn(),
  recordTicketEvent: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject
}));

vi.mock("@/server/tickets", async () => {
  const actual = await vi.importActual<typeof import("@/server/tickets")>("@/server/tickets");
  return {
    ...actual,
    recordTicketEvent: mocks.recordTicketEvent
  };
});

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  enqueueAgentEvent: mocks.enqueueAgentEvent,
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

import { attachCallRecording } from "@/server/calls/service";

const ORIGINAL_FETCH = global.fetch;
const TENANT_ID = "99999999-9999-4999-8999-999999999999";

describe("attachCallRecording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CALLS_TWILIO_ACCOUNT_SID = "AC123";
    process.env.CALLS_TWILIO_AUTH_TOKEN = "auth-token";
    mocks.putObject.mockResolvedValue("messages/message-1/recording.mp3");
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.buildAgentEvent.mockReturnValue({
      eventType: "ticket.call.recording.ready",
      ticketId: "ticket-1",
      messageId: "message-1",
      mailboxId: "mailbox-1",
      excerpt: "Call recording ready",
      threadId: "call-session-1"
    });
    mocks.enqueueAgentEvent.mockResolvedValue(undefined);
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(Buffer.from("audio"), {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      })
    ) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete process.env.CALLS_TWILIO_ACCOUNT_SID;
    delete process.env.CALLS_TWILIO_AUTH_TOKEN;
  });

  it("stores the canonical recording url as a 6esk attachment url after uploading to R2", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "call-session-1",
            tenant_id: TENANT_ID,
            ticket_id: "ticket-1",
            mailbox_id: "mailbox-1",
            message_id: "message-1",
            provider: "http_bridge",
            provider_call_id: "provider-call-1",
            status: "completed",
            event_sequence: 2,
            to_phone: "+27123456789",
            from_phone: "+27110000000",
            recording_url: null,
            recording_r2_key: null,
            transcript_r2_key: null,
            metadata: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ event_sequence: 3 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "job-1", status: "queued", provider: "managed_http" }]
      });

    const result = await attachCallRecording({
      callSessionId: "call-session-1",
      provider: "http_bridge",
      providerCallId: "provider-call-1",
      recordingUrl: "https://bridge.6ex.test/recordings/bridge-1.mp3",
      durationSeconds: 42
    });

    expect(result).toMatchObject({
      status: "attached",
      callSessionId: "call-session-1",
      recordingUrl: expect.stringMatching(
        /^\/api\/attachments\/[0-9a-f-]+\?disposition=inline$/
      ),
      recordingR2Key: "messages/message-1/recording.mp3"
    });

    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "messages/message-1/recording.mp3",
        contentType: "audio/mpeg"
      })
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO attachments (tenant_id"),
      expect.arrayContaining([TENANT_ID, "message-1", "Call Recording.mp3"])
    );

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("SET recording_url = $2"),
      [
        "call-session-1",
        expect.stringMatching(/^\/api\/attachments\/[0-9a-f-]+\?disposition=inline$/),
        "messages/message-1/recording.mp3",
        42
      ]
    );

    expect(mocks.recordTicketEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        eventType: "call_recording_ready",
        data: expect.objectContaining({
          recordingUrl: expect.stringMatching(/^\/api\/attachments\/[0-9a-f-]+\?disposition=inline$/),
          recordingR2Key: "messages/message-1/recording.mp3"
        })
      })
    );

    expect(mocks.dbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO call_transcript_jobs"),
      [
        TENANT_ID,
        "call-session-1",
        "managed_http",
        "messages/message-1/recording.mp3",
        expect.any(String)
      ]
    );
  });

  it("fetches Twilio recordings with provider auth and normalized media url", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "call-session-1",
            tenant_id: TENANT_ID,
            ticket_id: "ticket-1",
            mailbox_id: "mailbox-1",
            message_id: "message-1",
            provider: "twilio",
            provider_call_id: "CA123",
            status: "completed",
            event_sequence: 2,
            to_phone: "+27123456789",
            from_phone: "+27110000000",
            recording_url: null,
            recording_r2_key: null,
            transcript_r2_key: null,
            metadata: null
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ event_sequence: 3 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "job-1", status: "queued", provider: "managed_http" }]
      });

    await attachCallRecording({
      provider: "twilio",
      providerCallId: "CA123",
      recordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE123"
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE123.mp3",
      expect.objectContaining({
        headers: {
          Authorization: `Basic ${Buffer.from("AC123:auth-token").toString("base64")}`
        }
      })
    );
  });
});
