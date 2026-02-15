import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getInboundAlertConfig: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/email/inbound-alert-config", () => ({
  getInboundAlertConfig: mocks.getInboundAlertConfig
}));

import { sendInboundFailureAlert } from "@/server/email/inbound-alerts";

const ORIGINAL_FETCH = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

describe("sendInboundFailureAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInboundAlertConfig.mockResolvedValue({
      source: "db",
      webhookUrl: "https://alerts.example.com/inbound",
      threshold: 5,
      windowMinutes: 30,
      cooldownMinutes: 60
    });
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => ""
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("returns missing_webhook without querying events when webhook is absent", async () => {
    mocks.getInboundAlertConfig.mockResolvedValue({
      source: "db",
      webhookUrl: "",
      threshold: 5,
      windowMinutes: 30,
      cooldownMinutes: 60
    });

    const result = await sendInboundFailureAlert();

    expect(result).toMatchObject({
      sent: false,
      reason: "missing_webhook",
      threshold: 5
    });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns below_threshold when failures are lower than configured threshold", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ count: "3" }] });

    const result = await sendInboundFailureAlert();

    expect(result).toMatchObject({
      sent: false,
      reason: "below_threshold",
      failures: 3,
      threshold: 5
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
  });

  it("returns cooldown when recent alert was already sent", async () => {
    const lastSent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ count: "8" }] })
      .mockResolvedValueOnce({ rows: [{ last_sent_at: lastSent }] });

    const result = await sendInboundFailureAlert();

    expect(result).toMatchObject({
      sent: false,
      reason: "cooldown",
      failures: 8,
      threshold: 5
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.dbQuery).toHaveBeenCalledTimes(2);
  });

  it("sends webhook with top classified failure reasons when threshold is met", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ count: "8" }] })
      .mockResolvedValueOnce({ rows: [{ last_sent_at: null }] })
      .mockResolvedValueOnce({
        rows: [
          { last_error: "invalid payload for inbound schema", count: 5 },
          { last_error: "timeout calling provider", count: 3 }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await sendInboundFailureAlert();

    expect(result).toMatchObject({
      sent: true,
      reason: "sent",
      failures: 8
    });
    expect(result.topFailureReasons).toMatchObject([
      { code: "invalid_payload", count: 5 },
      { code: "provider_timeout", count: 3 }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://alerts.example.com/inbound");
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload).toMatchObject({
      failures: 8,
      threshold: 5
    });
    expect(payload.topFailureReasons).toMatchObject([
      { code: "invalid_payload", count: 5 },
      { code: "provider_timeout", count: 3 }
    ]);
    expect(payload.text).toContain("Top reasons:");
    expect(mocks.dbQuery).toHaveBeenCalledTimes(4);
  });
});
