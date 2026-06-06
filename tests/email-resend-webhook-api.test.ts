import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyResendWebhookPayload = vi.fn();
const mapReceivedEmailToInboundPayload = vi.fn();
const processInboundEmailPayload = vi.fn();
const listActiveProviderWebhookSecrets = vi.fn();
const markProviderWebhookSecretUsed = vi.fn();

vi.mock("@/server/email/resend-webhook", () => ({
  verifyResendWebhookPayload,
  mapReceivedEmailToInboundPayload
}));

vi.mock("@/server/email/process-inbound", () => ({
  processInboundEmailPayload
}));

vi.mock("@/server/provider-webhook-secrets", async () => {
  const actual = await vi.importActual<typeof import("@/server/provider-webhook-secrets")>(
    "@/server/provider-webhook-secrets"
  );
  return {
    ...actual,
    listActiveProviderWebhookSecrets,
    markProviderWebhookSecretUsed
  };
});

describe("POST /api/email/webhooks/resend", () => {
  const originalProviderWebhookRequireSecrets = process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS;

  beforeEach(() => {
    vi.resetModules();
    verifyResendWebhookPayload.mockReset();
    mapReceivedEmailToInboundPayload.mockReset();
    processInboundEmailPayload.mockReset();
    listActiveProviderWebhookSecrets.mockReset();
    markProviderWebhookSecretUsed.mockReset();
    listActiveProviderWebhookSecrets.mockResolvedValue([]);
    markProviderWebhookSecretUsed.mockResolvedValue(undefined);
    if (originalProviderWebhookRequireSecrets === undefined) {
      delete process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS;
    } else {
      process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = originalProviderWebhookRequireSecrets;
    }
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

  it("requires tenant scope when tenant provider webhook secrets are strict", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";

    const { POST } = await import("@/app/api/email/webhooks/resend/route");
    const response = await POST(
      new Request("http://localhost/api/email/webhooks/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "email.received" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "provider_webhook_tenant_scope_required"
    });
    expect(verifyResendWebhookPayload).not.toHaveBeenCalled();
  });

  it("verifies scoped Resend webhooks with tenant provider secrets", async () => {
    process.env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS = "true";
    listActiveProviderWebhookSecrets.mockResolvedValueOnce([
      { id: "secret-1", secret: "tenant-resend-secret", source: "db" }
    ]);
    verifyResendWebhookPayload.mockReturnValue({
      type: "email.received",
      created_at: "2026-04-03T10:00:00Z",
      data: {
        email_id: "email-1"
      }
    });
    mapReceivedEmailToInboundPayload.mockResolvedValue({
      from: "user@example.com",
      to: ["support@tenant-a.test"],
      subject: "Need help",
      text: "Hello"
    });
    processInboundEmailPayload.mockResolvedValue({
      status: 200,
      body: { status: "processed" }
    });

    const { POST } = await import("@/app/api/email/webhooks/resend/route");
    const response = await POST(
      new Request(
        "http://localhost/api/email/webhooks/resend?tenant=tenant-a&workspace=workspace-a",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "email.received" })
        }
      )
    );

    expect(response.status).toBe(200);
    expect(listActiveProviderWebhookSecrets).toHaveBeenCalledWith({
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      provider: "resend",
      secretType: "webhook_secret"
    });
    expect(verifyResendWebhookPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookSecret: "tenant-resend-secret"
      })
    );
    expect(markProviderWebhookSecretUsed).toHaveBeenCalledWith("secret-1", {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    expect(processInboundEmailPayload).toHaveBeenCalledWith(expect.any(Object), {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
  });
});
