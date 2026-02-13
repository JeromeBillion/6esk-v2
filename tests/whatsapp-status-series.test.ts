import { describe, expect, it } from "vitest";
import {
  buildWhatsAppStatusSeries,
  parseWhatsAppStatusSource
} from "../src/server/analytics/whatsapp-series";

describe("buildWhatsAppStatusSeries", () => {
  it("normalizes mixed numeric types and keeps all status columns", () => {
    const series = buildWhatsAppStatusSeries([
      {
        day: new Date("2026-02-12T00:00:00.000Z"),
        sent: "10",
        delivered: 8,
        read: null,
        failed: "2"
      }
    ]);

    expect(series).toEqual({
      sent: [{ day: "2026-02-12T00:00:00.000Z", count: 10 }],
      delivered: [{ day: "2026-02-12T00:00:00.000Z", count: 8 }],
      read: [{ day: "2026-02-12T00:00:00.000Z", count: 0 }],
      failed: [{ day: "2026-02-12T00:00:00.000Z", count: 2 }]
    });
  });

  it("sorts rows chronologically before building the series", () => {
    const series = buildWhatsAppStatusSeries([
      {
        day: new Date("2026-02-13T00:00:00.000Z"),
        sent: 3,
        delivered: 2,
        read: 1,
        failed: 0
      },
      {
        day: new Date("2026-02-12T00:00:00.000Z"),
        sent: 5,
        delivered: 4,
        read: 2,
        failed: 1
      }
    ]);

    expect(series.sent.map((row) => row.day)).toEqual([
      "2026-02-12T00:00:00.000Z",
      "2026-02-13T00:00:00.000Z"
    ]);
    expect(series.failed.map((row) => row.count)).toEqual([1, 0]);
  });

  it("parses source filters safely", () => {
    expect(parseWhatsAppStatusSource("outbox")).toBe("outbox");
    expect(parseWhatsAppStatusSource("webhook")).toBe("webhook");
    expect(parseWhatsAppStatusSource("invalid")).toBe("all");
    expect(parseWhatsAppStatusSource(null)).toBe("all");
  });
});
