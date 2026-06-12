import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyResendWebhookPayload = vi.fn();
const mapReceivedEmailToInboundPayload = vi.fn();
const processInboundEmailPayload = vi.fn();
const listActiveProviderWebhookSecrets = vi.fn();
const markProviderWebhookSecretUsed = vi.fn();
const shouldRequireTenantProviderWebhookSecrets = vi.fn();
const findMailbox = vi.fn();
const TENANT_ID = "33333333-3333-3333-3333-333333333333";
const FOREIGN_TENANT_ID = "44444444-4444-4444-4444-444444444444";

class ProviderWebhookSecretConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderWebhookSecretConfigurationError";
  }
}

vi.mock("@/server/email/resend-webhook", () => ({
  verifyResendWebhookPayload,
  mapReceivedEmailToInboundPayload
}));

vi.mock("@/server/email/process-inbound", () => ({
  processInboundEmailPayload
}));

vi.mock("@/server/provider-webhook-secrets", () => ({
  listActiveProviderWebhookSecrets,
  markProviderWebhookSecretUsed,
  shouldRequireTenantProviderWebhookSecrets,
  ProviderWebhookSecretConfigurationError
}));

vi.mock("@/server/email/mailbox", () => ({
  findMailbox
}));

describe("POST /api/email/webhooks/resend", () => {
  beforeEach(() => {
    vi.resetModules();
    verifyResendWebhookPayload.mockReset();
    mapReceivedEmailToInboundPayload.mockReset();
    processInboundEmailPayload.mockReset();
    listActiveProviderWebhookSecrets.mockReset();
    markProviderWebhookSecretUsed.mockReset();
    shouldRequireTenantProviderWebhookSecrets.mockReset();
    findMailbox.mockReset();
    listActiveProviderWebhookSecrets.mockResolvedValue([]);
    markProviderWebhookSecretUsed.mockResolvedValue(undefined);
    shouldRequireTenantProviderWebhookSecrets.mockReturnValue(false);
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

  it("requires explicit tenant scope for Resend webhooks in strict provider-secret mode", async () => {
    shouldRequireTenantProviderWebhookSecrets.mockReturnValue(true);

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
      code: "provider_webhook_tenant_scope_required",
      error: "Tenant scope is required for Resend webhooks."
    });
    expect(verifyResendWebhookPayload).not.toHaveBeenCalled();
  });

  it("verifies Resend webhooks with a tenant-scoped persisted provider secret", async () => {
    shouldRequireTenantProviderWebhookSecrets.mockReturnValue(true);
    listActiveProviderWebhookSecrets.mockResolvedValue([
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
      to: ["support@example.com"],
      subject: "Need help",
      text: "Hello"
    });
    findMailbox.mockResolvedValue({
      id: "mailbox-1",
      tenant_id: TENANT_ID,
      type: "platform",
      address: "support@example.com",
      owner_user_id: null
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
      new Request(
        `http://localhost/api/email/webhooks/resend?tenantId=${TENANT_ID}&workspace=primary`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "email.received" })
        }
      )
    );

    expect(response.status).toBe(200);
    expect(listActiveProviderWebhookSecrets).toHaveBeenCalledWith({
      scope: { tenantId: TENANT_ID, workspaceKey: "primary" },
      provider: "resend",
      secretType: "webhook_secret"
    });
    expect(verifyResendWebhookPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookSecret: "tenant-resend-secret"
      })
    );
    expect(markProviderWebhookSecretUsed).toHaveBeenCalledWith("secret-1", {
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });
    expect(processInboundEmailPayload).toHaveBeenCalledTimes(1);
  });

  it("rejects scoped Resend payloads whose recipient mailbox belongs to another tenant", async () => {
    shouldRequireTenantProviderWebhookSecrets.mockReturnValue(true);
    listActiveProviderWebhookSecrets.mockResolvedValue([
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
      to: ["support@foreign.example.com"],
      subject: "Need help",
      text: "Hello"
    });
    findMailbox.mockResolvedValue({
      id: "mailbox-foreign",
      tenant_id: FOREIGN_TENANT_ID,
      type: "platform",
      address: "support@foreign.example.com",
      owner_user_id: null
    });

    const { POST } = await import("@/app/api/email/webhooks/resend/route");
    const response = await POST(
      new Request(
        `http://localhost/api/email/webhooks/resend?tenantId=${TENANT_ID}&workspace=primary`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "email.received" })
        }
      )
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      code: "provider_webhook_tenant_mismatch",
      error: "Webhook payload does not match tenant scope"
    });
    expect(processInboundEmailPayload).not.toHaveBeenCalled();
  });
});
