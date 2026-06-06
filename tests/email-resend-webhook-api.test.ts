import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyResendWebhookPayload = vi.fn();
const mapReceivedEmailToInboundPayload = vi.fn();
const processInboundEmailPayload = vi.fn();

vi.mock("@/server/email/resend-webhook", () => ({
  verifyResendWebhookPayload,
  mapReceivedEmailToInboundPayload
}));

vi.mock("@/server/email/process-inbound", () => ({
  processInboundEmailPayload
}));

describe("POST /api/email/webhooks/resend", () => {
  beforeEach(() => {
    vi.resetModules();
    verifyResendWebhookPayload.mockReset();
    mapReceivedEmailToInboundPayload.mockReset();
    processInboundEmailPayload.mockReset();
  });

  it("rejects invalid webhook signatures", async () => {
    verifyResendWebhookPayload.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const { POST } = await import("@/app/api/email/webhooks/resend/route");
    const response = await POST(
      new Request("http://localhost/api/email/webhooks/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "email.received" })
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });

  it("ignores non-received events", async () => {
    verifyResendWebhookPayload.mockReturnValue({
      type: "email.delivered",
      created_at: "2026-04-03T10:00:00Z",
      data: { email_id: "email-1" }
    });

    const { POST } = await import("@/app/api/email/webhooks/resend/route");
    const response = await POST(
      new Request("http://localhost/api/email/webhooks/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "email.delivered" })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ignored",
      event: "email.delivered"
    });
    expect(mapReceivedEmailToInboundPayload).not.toHaveBeenCalled();
  });

  it("processes received email events", async () => {
    verifyResendWebhookPayload.mockReturnValue({
      type: "email.received",
      created_at: "2026-04-03T10:00:00Z",
      data: {
        email_id: "email-1"
      }
    });
    mapReceivedEmailToInboundPayload.mockResolvedValue({
      from: "user@example.com",
      to: ["support@6ex.co.za"],
      subject: "Need help",
      text: "Hello"
    });
    processInboundEmailPayload.mockResolvedValue({
      status: 200,
      body: {
        status: "processed",
        id: "message-1",
        mailboxId: "mailbox-1"
      }
    });

    const { POST } = await import("@/app/api/email/webhooks/resend/route");
    const response = await POST(
      new Request("http://localhost/api/email/webhooks/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "email.received" })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "processed",
      id: "message-1",
      mailboxId: "mailbox-1",
      event: "email.received",
      emailId: "email-1"
    });
    expect(mapReceivedEmailToInboundPayload).toHaveBeenCalledTimes(1);
    expect(processInboundEmailPayload).toHaveBeenCalledTimes(1);
  });
});
