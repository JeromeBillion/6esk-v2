import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCallWebhookSignature } from "@/server/calls/webhook";

const mocks = vi.hoisted(() => ({
  updateCallSessionStatus: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/calls/service", () => ({
  CALL_STATUSES: [
    "queued",
    "dialing",
    "ringing",
    "in_progress",
    "completed",
    "no_answer",
    "busy",
    "failed",
    "canceled"
  ] as const,
  updateCallSessionStatus: mocks.updateCallSessionStatus
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/calls/status/route";

const ORIGINAL_ENV = { ...process.env };

function sign(body: string, timestamp?: string | null) {
  return buildCallWebhookSignature(body, "voice-webhook-secret", timestamp);
}

function statusPayload() {
  return {
    provider: "mock",
    providerCallId: "provider-call-1",
    status: "ringing",
    timestamp: new Date().toISOString()
  };
}

describe("POST /api/calls/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CALLS_WEBHOOK_SECRET = "voice-webhook-secret";
    process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS = "300";
    delete process.env.INBOUND_SHARED_SECRET;

    mocks.updateCallSessionStatus.mockResolvedValue({
      status: "updated",
      callSessionId: "call-session-1",
      previousStatus: "queued",
      currentStatus: "ringing",
      ticketId: "ticket-1",
      mailboxId: "mailbox-1",
      messageId: "message-1"
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts signed status webhooks within replay window", async () => {
    const bodyObject = statusPayload();
    const body = JSON.stringify(bodyObject);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await POST(
      new Request("http://localhost/api/calls/status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-signature": sign(body, timestamp),
          "x-6esk-timestamp": timestamp
        },
        body
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "updated",
      callSessionId: "call-session-1",
      currentStatus: "ringing"
    });
    expect(mocks.updateCallSessionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCallId: "provider-call-1",
        status: "ringing"
      })
    );
  });

  it("rejects signed status webhooks without timestamp", async () => {
    const bodyObject = statusPayload();
    const body = JSON.stringify(bodyObject);

    const response = await POST(
      new Request("http://localhost/api/calls/status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-signature": sign(body)
        },
        body
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({ error: "Unauthorized" });
    expect(mocks.updateCallSessionStatus).not.toHaveBeenCalled();
  });

  it("rejects stale signed status webhooks outside replay window", async () => {
    const bodyObject = statusPayload();
    const body = JSON.stringify(bodyObject);
    const staleTimestamp = Math.floor(Date.now() / 1000 - 3600).toString();

    const response = await POST(
      new Request("http://localhost/api/calls/status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-signature": sign(body, staleTimestamp),
          "x-6esk-timestamp": staleTimestamp
        },
        body
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({ error: "Unauthorized" });
    expect(mocks.updateCallSessionStatus).not.toHaveBeenCalled();
  });
});
