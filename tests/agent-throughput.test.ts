import { describe, expect, it } from "vitest";
import { parseMaxEventsPerRun, resolveDeliveryLimit } from "../src/server/agents/throughput";

describe("agent throughput controls", () => {
  it("parses configured max events per run from capabilities", () => {
    expect(parseMaxEventsPerRun({ max_events_per_run: 12 })).toBe(12);
    expect(parseMaxEventsPerRun({ max_events_per_run: "20" })).toBe(20);
    expect(parseMaxEventsPerRun({ max_events_per_run: 999 })).toBe(50);
  });

  it("returns null for missing or invalid configured caps", () => {
    expect(parseMaxEventsPerRun({})).toBeNull();
    expect(parseMaxEventsPerRun({ max_events_per_run: 0 })).toBeNull();
    expect(parseMaxEventsPerRun({ max_events_per_run: "bad" })).toBeNull();
  });

  it("enforces configured cap over requested limit", () => {
    expect(
      resolveDeliveryLimit({
        requestedLimit: 30,
        capabilities: { max_events_per_run: 7 }
      })
    ).toBe(7);
  });

  it("uses default when no requested limit is provided", () => {
    expect(resolveDeliveryLimit({ capabilities: {} })).toBe(5);
  });
});
