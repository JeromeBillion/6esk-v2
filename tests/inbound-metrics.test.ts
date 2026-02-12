import { describe, expect, it } from "vitest";
import { buildInboundHourlySeries } from "../src/server/email/inbound-metrics";

describe("buildInboundHourlySeries", () => {
  it("fills missing hours and keeps chronological order", () => {
    const now = new Date("2026-02-12T12:34:00.000Z");
    const series = buildInboundHourlySeries(
      [
        {
          hour: "2026-02-12T11:15:00.000Z",
          failed: "2",
          processed: "1",
          processing: "0",
          attempts: "3"
        }
      ],
      6,
      now
    );

    expect(series).toHaveLength(6);
    expect(series.slice(-3)).toEqual([
      {
        hour: "2026-02-12T10:00:00.000Z",
        failed: 0,
        processed: 0,
        processing: 0,
        attempts: 0
      },
      {
        hour: "2026-02-12T11:00:00.000Z",
        failed: 2,
        processed: 1,
        processing: 0,
        attempts: 3
      },
      {
        hour: "2026-02-12T12:00:00.000Z",
        failed: 0,
        processed: 0,
        processing: 0,
        attempts: 0
      }
    ]);
  });

  it("clamps requested window to supported bounds", () => {
    const now = new Date("2026-02-12T12:34:00.000Z");
    const minimumSeries = buildInboundHourlySeries([], 1, now);
    const maximumSeries = buildInboundHourlySeries([], 1000, now);

    expect(minimumSeries.length).toBe(6);
    expect(maximumSeries.length).toBe(72);
  });
});
