import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  updateCallSessionStatus: vi.fn(),
  twilioFactory: vi.fn(),
  twilioCreate: vi.fn(),
  twilioValidate: vi.fn()
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

vi.mock("twilio", () => {
  const callable = ((...args: unknown[]) => mocks.twilioFactory(...args)) as ((
    ...args: unknown[]
  ) => unknown) & { validateRequest: (...args: unknown[]) => unknown };
  callable.validateRequest = (...args: unknown[]) => mocks.twilioValidate(...args);
  return { default: callable };
});

import { deliverPendingCallEvents } from "@/server/calls/outbox";

const ORIGINAL_ENV = { ...process.env };

function mockLockedEvents(
  rows: Array<{ id: string; payload: Record<string, unknown>; attempt_count: number }>
) {
  const query = vi.fn();
  query.mockResolvedValueOnce(undefined);
  query.mockResolvedValueOnce({ rows });
  query.mockResolvedValueOnce(undefined);
  const release = vi.fn();
  mocks.dbConnect.mockResolvedValue({ query, release });
  return { query, release };
}

describe("call outbox twilio provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      CALLS_PROVIDER: "twilio",
      APP_URL: "https://app.6esk.test",
      CALLS_TWILIO_ACCOUNT_SID: "AC123",
      CALLS_TWILIO_AUTH_TOKEN: "auth-token",
      CALLS_TWILIO_FROM_NUMBER: "+27110000000",
      CALLS_TWILIO_BRIDGE_TARGET: "+27119999999"
    };
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.updateCallSessionStatus.mockResolvedValue({ status: "updated" });
    mocks.twilioFactory.mockReturnValue({
      calls: {
        create: mocks.twilioCreate
      }
    });
    mocks.twilioCreate.mockResolvedValue({
      sid: "CA123",
      status: "queued",
      to: "+27123456789",
      from: "+27110000000"
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("creates the outbound call directly in Twilio and updates the call session", async () => {
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
      provider: "twilio"
    });
    expect(mocks.twilioFactory).toHaveBeenCalledWith("AC123", "auth-token");
    expect(mocks.twilioCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+27123456789",
        from: "+27110000000",
        statusCallback: "https://app.6esk.test/api/calls/webhooks/twilio/status",
        statusCallbackMethod: "GET",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"]
      })
    );
    expect(mocks.updateCallSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "call-1",
        provider: "twilio",
        providerCallId: "CA123",
        status: "dialing"
      })
    );
  });
});
