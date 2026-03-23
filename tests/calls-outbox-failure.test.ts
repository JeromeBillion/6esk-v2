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

import { deliverPendingCallEvents, retryFailedCallOutboxEvents } from "@/server/calls/outbox";

const ORIGINAL_ENV = { ...process.env };

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

describe("call outbox hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.CALLS_PROVIDER;
    delete process.env.CALLS_OUTBOX_PROCESSING_RECOVERY_SECONDS;
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.updateCallSessionStatus.mockResolvedValue({ status: "updated" });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("delivers queued events with mock provider and updates call session to dialing", async () => {
    process.env.CALLS_PROVIDER = "mock";
    const lock = mockLockedEvents([
      {
        id: "evt-1",
        payload: { callSessionId: "call-1" },
        attempt_count: 0
      }
    ]);

    const result = await deliverPendingCallEvents({ limit: 1 });

    expect(result).toMatchObject({ delivered: 1, skipped: 0, provider: "mock" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("SET status = 'sent'"), [
      "evt-1"
    ]);
    expect(mocks.updateCallSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "call-1",
        provider: "mock",
        providerCallId: "mock-evt-1",
        status: "dialing"
      })
    );
    expect(lock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'processing'"),
      [1, 300]
    );
  });

  it("uses configured processing recovery timeout when locking events", async () => {
    process.env.CALLS_PROVIDER = "mock";
    process.env.CALLS_OUTBOX_PROCESSING_RECOVERY_SECONDS = "90";
    const lock = mockLockedEvents([]);

    await deliverPendingCallEvents({ limit: 2 });

    expect(lock.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("make_interval(secs => $2::int)"),
      [2, 90]
    );
  });

  it("requeues failed delivery attempts before terminal threshold", async () => {
    process.env.CALLS_PROVIDER = "twilio";
    mockLockedEvents([
      {
        id: "evt-1",
        payload: { callSessionId: "call-1" },
        attempt_count: 1
      }
    ]);

    const result = await deliverPendingCallEvents({ limit: 1 });

    expect(result).toMatchObject({ delivered: 0, skipped: 1, provider: "twilio" });
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    const call = mocks.dbQuery.mock.calls[0];
    expect(call[0]).toContain("UPDATE call_outbox_events");
    expect(call[1][0]).toBe("queued");
    expect(call[1][1]).toBe(2);
    expect(call[1][2]).toContain("not configured");
    expect(call[1][4]).toBe("evt-1");
    expect(mocks.updateCallSessionStatus).not.toHaveBeenCalled();
  });

  it("moves delivery to failed and marks call session failed on terminal retry attempt", async () => {
    process.env.CALLS_PROVIDER = "twilio";
    mockLockedEvents([
      {
        id: "evt-1",
        payload: { callSessionId: "call-1" },
        attempt_count: 4
      }
    ]);

    const result = await deliverPendingCallEvents({ limit: 1 });

    expect(result).toMatchObject({ delivered: 0, skipped: 1, provider: "twilio" });
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    const call = mocks.dbQuery.mock.calls[0];
    expect(call[1][0]).toBe("failed");
    expect(call[1][1]).toBe(5);
    expect(call[1][2]).toContain("not configured");
    expect(mocks.updateCallSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "call-1",
        status: "failed"
      })
    );
  });

  it("retries failed events with clamped limit", async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce(undefined); // BEGIN
    query.mockResolvedValueOnce({ rows: [{ id: "evt-1" }, { id: "evt-2" }] }); // UPDATE RETURNING
    query.mockResolvedValueOnce(undefined); // COMMIT
    mocks.dbConnect.mockResolvedValue({ query, release: vi.fn() });

    const result = await retryFailedCallOutboxEvents({ limit: 500 });

    expect(result).toMatchObject({
      requested: 100,
      retried: 2,
      ids: ["evt-1", "evt-2"]
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE call_outbox_events evt"),
      [100]
    );
  });
});
