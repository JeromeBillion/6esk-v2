import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCallWebhookSignature } from "@/server/calls/webhook";

const mocks = vi.hoisted(() => ({
  createOrUpdateInboundCall: vi.fn(),
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
  createOrUpdateInboundCall: mocks.createOrUpdateInboundCall
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/calls/inbound/route";

const ORIGINAL_ENV = { ...process.env };

function sign(body: string, timestamp?: string | null) {
  return buildCallWebhookSignature(body, "voice-webhook-secret", timestamp);
}

function inboundPayload() {
  return {
    provider: "mock",
    providerCallId: "call-1",
    from: "+15551234567",
    to: "+15557654321",
    status: "ringing",
    timestamp: new Date().toISOString()
  };
}

describe("POST /api/calls/inbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.CALLS_WEBHOOK_SECRET = "voice-webhook-secret";
    process.env.CALLS_WEBHOOK_MAX_SKEW_SECONDS = "300";
    delete process.env.INBOUND_SHARED_SECRET;

    mocks.createOrUpdateInboundCall.mockResolvedValue({
      status: "created",
      callSessionId: "session-1",
      messageId: "msg-1",
      ticketId: "ticket-1",
      createdTicket: false
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts signed webhook requests within replay window", async () => {
    const bodyObject = inboundPayload();
    const body = JSON.stringify(bodyObject);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await POST(
      new Request("http://localhost/api/calls/inbound", {
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
      acknowledged: true,
      status: "created",
      callSessionId: "session-1"
    });
    expect(mocks.createOrUpdateInboundCall).toHaveBeenCalledWith(
      expect.objectContaining({
        providerCallId: "call-1",
        fromPhone: "+15551234567"
      })
    );
  });

  it("rejects signed webhook requests that are missing timestamp", async () => {
    const bodyObject = inboundPayload();
    const body = JSON.stringify(bodyObject);

    const response = await POST(
      new Request("http://localhost/api/calls/inbound", {
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
    expect(mocks.createOrUpdateInboundCall).not.toHaveBeenCalled();
  });

  it("rejects signed webhook requests outside replay window", async () => {
    const bodyObject = inboundPayload();
    const body = JSON.stringify(bodyObject);
    const staleTimestamp = Math.floor(Date.now() / 1000 - 3600).toString();

    const response = await POST(
      new Request("http://localhost/api/calls/inbound", {
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
    expect(mocks.createOrUpdateInboundCall).not.toHaveBeenCalled();
  });
});
