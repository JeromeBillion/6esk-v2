import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeCallWebhook: vi.fn(),
  attachCallTranscript: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/calls/webhook", () => ({
  authorizeCallWebhook: mocks.authorizeCallWebhook
}));

vi.mock("@/server/calls/service", () => ({
  attachCallTranscript: mocks.attachCallTranscript
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/calls/transcript/route";

describe("POST /api/calls/transcript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.authorizeCallWebhook.mockReturnValue({
      authorized: true,
      mode: "hmac",
      reason: "ok"
    });
    mocks.attachCallTranscript.mockResolvedValue({
      status: "attached",
      callSessionId: "11111111-1111-1111-1111-111111111111",
      transcriptR2Key: "messages/msg/transcript.txt",
      attachmentId: "22222222-2222-2222-2222-222222222222"
    });
  });

  it("returns 401 when webhook authorization fails", async () => {
    mocks.authorizeCallWebhook.mockReturnValue({
      authorized: false,
      mode: "hmac",
      reason: "invalid_signature"
    });

    const response = await POST(
      new Request("http://localhost/api/calls/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 400 when transcript payload is missing text/url", async () => {
    const response = await POST(
      new Request("http://localhost/api/calls/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callSessionId: "11111111-1111-1111-1111-111111111111"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "transcriptText or transcriptUrl is required"
    });
  });

  it("attaches transcript when payload is valid", async () => {
    const response = await POST(
      new Request("http://localhost/api/calls/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          callSessionId: "11111111-1111-1111-1111-111111111111",
          transcriptText: "Customer asked for payout timeline."
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "attached",
      callSessionId: "11111111-1111-1111-1111-111111111111"
    });
    expect(mocks.attachCallTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        callSessionId: "11111111-1111-1111-1111-111111111111",
        transcriptText: "Customer asked for payout timeline."
      })
    );
  });
});
