import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  updateCallSessionStatus: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/calls/service", () => ({
  updateCallSessionStatus: mocks.updateCallSessionStatus
}));

import { deliverPendingCallEvents } from "@/server/calls/outbox";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

function mockLockedEvents(
  rows: Array<{ id: string; payload: Record<string, unknown>; attempt_count: number }>
) {
  const query = vi.fn();
  query.mockResolvedValueOnce(undefined); // BEGIN
  query.mockResolvedValueOnce({ rows }); // lock + return rows
  query.mockResolvedValueOnce(undefined); // COMMIT
  const release = vi.fn();
  mocks.dbConnect.mockResolvedValue({ query, release });
  return { query, release };
}

describe("call outbox http bridge provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_PROVIDER: "http_bridge",
      CALLS_PROVIDER_HTTP_URL: "https://bridge.local/outbound-calls",
      CALLS_PROVIDER_HTTP_SECRET: "bridge-secret",
      INBOUND_SHARED_SECRET: "callback-secret",
      APP_URL: "https://app.6esk.test"
    };
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.updateCallSessionStatus.mockResolvedValue({ status: "updated" });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ providerCallId: "provider-call-123" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
  });

  it("posts outbound call payload to the configured bridge and updates the call session", async () => {
    mockLockedEvents([
      {
        id: "evt-1",
        attempt_count: 0,
        payload: {
          callSessionId: "call-1",
          ticketId: "ticket-1",
          messageId: "message-1",
          toPhone: "+27123456789",
          fromPhone: "+27110000000",
          reason: "Customer requested callback"
        }
      }
    ]);

    const result = await deliverPendingCallEvents({ limit: 1 });

    expect(result).toMatchObject({
      delivered: 1,
      skipped: 0,
      provider: "http_bridge"
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://bridge.local/outbound-calls");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-6esk-secret": "bridge-secret"
      }
    });

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      eventId: "evt-1",
      callSessionId: "call-1",
      ticketId: "ticket-1",
      messageId: "message-1",
      toPhone: "+27123456789",
      fromPhone: "+27110000000",
      reason: "Customer requested callback",
      callbacks: {
        statusUrl: "https://app.6esk.test/api/calls/status",
        recordingUrl: "https://app.6esk.test/api/calls/recording",
        transcriptUrl: "https://app.6esk.test/api/calls/transcript",
        auth: {
          sharedSecret: "callback-secret"
        }
      }
    });

    expect(mocks.updateCallSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "call-1",
        provider: "http_bridge",
        providerCallId: "provider-call-123",
        status: "dialing"
      })
    );
  });
});
