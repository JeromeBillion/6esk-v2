import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getMicrosoftWebhookClientState: vi.fn()
}));

vi.mock("@/server/oauth/providers/microsoft", () => ({
  getMicrosoftWebhookClientState: mocks.getMicrosoftWebhookClientState
}));

vi.mock("@/server/logger", () => ({
  requestLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}));

import { POST } from "@/app/api/oauth/webhooks/microsoft/route";

function webhookRequest(value: Array<Record<string, unknown>>) {
  return new NextRequest("https://app.example.com/api/oauth/webhooks/microsoft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value })
  });
}

describe("Microsoft OAuth webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMicrosoftWebhookClientState.mockReturnValue("expected-state");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("OK")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not wake mailbox sync when notifications fail clientState validation", async () => {
    const response = await POST(
      webhookRequest([
        {
          subscriptionId: "sub-1",
          clientState: "wrong-state"
        }
      ])
    );

    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("wakes mailbox sync when at least one notification validates", async () => {
    const response = await POST(
      webhookRequest([
        {
          subscriptionId: "sub-1",
          clientState: "expected-state"
        }
      ])
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith("https://app.example.com/api/cron/sync-mailboxes", {
      headers: {
        Authorization: "Bearer "
      }
    });
  });
});
