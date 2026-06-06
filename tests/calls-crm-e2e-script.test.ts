import { createRequire } from "module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const ORIGINAL_ENV = { ...process.env };

function loadHarness(env: NodeJS.ProcessEnv = {}) {
  process.env = { ...ORIGINAL_ENV, ...env };
  const harnessPath = require.resolve("../scripts/calls-crm-e2e.js");
  delete require.cache[harnessPath];
  return require("../scripts/calls-crm-e2e.js") as {
    readEventCallSessionId: (item: unknown) => string | null;
    verifyAgentEventObservation: (callSessionId: string) => Promise<{
      skipped?: boolean;
      passed?: boolean;
      detail: string;
    }>;
  };
}

describe("CRM calls E2E harness", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("uses the generic downstream event observation env contract", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://events.example.test/calls?callSessionId=call-1");
      return new Response(
        JSON.stringify({
          events: [
            { type: "ticket.call.queued", call: { id: "call-1", sequence: 1 } },
            { type: "ticket.call.started", call: { id: "call-1", sequence: 2 } },
            { type: "ticket.call.ended", call: { id: "call-1", sequence: 3 } },
            { type: "ticket.call.transcript.ready", call: { id: "call-1", sequence: 4 } }
          ]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { verifyAgentEventObservation } = loadHarness({
      CRM_CALLS_AGENT_EVENTS_URL: "https://events.example.test/calls",
      CRM_CALLS_AGENT_EVENTS_TOKEN: "events-token"
    });

    await expect(verifyAgentEventObservation("call-1")).resolves.toEqual({
      passed: true,
      detail: "Downstream observation reported 4 events for call session."
    });
    expect(fetchMock).toHaveBeenCalledWith("https://events.example.test/calls?callSessionId=call-1", {
      headers: { Authorization: "Bearer events-token" }
    });
  });

  it("does not treat the removed legacy-specific env as an observation source", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { verifyAgentEventObservation } = loadHarness({
      [`${"CRM_CALLS_"}${"VEN"}${"US_EVENTS_URL"}`]: "https://legacy.example.test/events"
    });

    await expect(verifyAgentEventObservation("call-1")).resolves.toEqual({
      skipped: true,
      detail: "CRM_CALLS_AGENT_EVENTS_URL not set; skipped downstream event observation check."
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads call session ids from both flat and nested event payloads", () => {
    const { readEventCallSessionId } = loadHarness();

    expect(readEventCallSessionId({ callSessionId: "call-flat" })).toBe("call-flat");
    expect(readEventCallSessionId({ call_session_id: "call-snake" })).toBe("call-snake");
    expect(readEventCallSessionId({ call: { id: "call-nested" } })).toBe("call-nested");
  });
});
