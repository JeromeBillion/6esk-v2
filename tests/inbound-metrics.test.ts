import { describe, expect, it } from "vitest";
import {
  aggregateInboundFailureReasons,
  buildInboundAlertThresholdRecommendation,
  buildInboundHourlySeries,
  classifyInboundFailureReason
} from "../src/server/email/inbound-metrics";

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

  it("derives alert threshold recommendation range from historical buckets", () => {
    const recommendation = buildInboundAlertThresholdRecommendation({
      configuredThreshold: 3,
      avgBucketFailures: 2.1,
      p95BucketFailures: 5.7,
      maxBucketFailures: 8,
      bucketCount: 20
    });

    expect(recommendation).toMatchObject({
      suggestedMinThreshold: 3,
      suggestedMaxThreshold: 6,
      inRange: true,
      reason: "aligned"
    });
  });

  it("keeps current threshold when history is insufficient", () => {
    const recommendation = buildInboundAlertThresholdRecommendation({
      configuredThreshold: 9,
      avgBucketFailures: 1.3,
      p95BucketFailures: 3.2,
      maxBucketFailures: 6,
      bucketCount: 2
    });

    expect(recommendation).toMatchObject({
      suggestedMinThreshold: 9,
      suggestedMaxThreshold: 9,
      inRange: true,
      reason: "insufficient_history"
    });
  });

  it("classifies inbound failure reasons from error text", () => {
    expect(classifyInboundFailureReason("Stored payload is invalid for inbound schema")).toMatchObject({
      code: "invalid_payload"
    });
    expect(classifyInboundFailureReason("timeout while calling provider")).toMatchObject({
      code: "provider_timeout"
    });
    expect(classifyInboundFailureReason("429 rate limit")).toMatchObject({
      code: "provider_rate_limited"
    });
    expect(classifyInboundFailureReason("postgres connection failed")).toMatchObject({
      code: "database_error"
    });
  });

  it("aggregates top failure reasons by classified code", () => {
    const top = aggregateInboundFailureReasons([
      { last_error: "timeout at upstream provider", count: 2 },
      { last_error: "request aborted due to timeout", count: 3 },
      { last_error: "Stored payload is invalid for inbound schema", count: 4 },
      { last_error: "429 rate limit", count: 1 }
    ]);

    expect(top[0]).toMatchObject({
      code: "provider_timeout",
      count: 5
    });
    expect(top[1]).toMatchObject({
      code: "invalid_payload",
      count: 4
    });
  });
});
