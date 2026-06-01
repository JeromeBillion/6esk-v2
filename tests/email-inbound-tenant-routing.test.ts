import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  computeIdempotencyKey: vi.fn(),
  createInboundEvent: vi.fn(),
  markInboundProcessed: vi.fn(),
  markInboundFailed: vi.fn(),
  storeInboundEmail: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/email/inbound-events", () => ({
  computeIdempotencyKey: mocks.computeIdempotencyKey,
  createInboundEvent: mocks.createInboundEvent,
  markInboundProcessed: mocks.markInboundProcessed,
  markInboundFailed: mocks.markInboundFailed
}));

vi.mock("@/server/email/inbound-store", () => ({
  storeInboundEmail: mocks.storeInboundEmail
}));

import { processInboundEmailPayload } from "@/server/email/process-inbound";

const originalTenantIngressRequireScope = process.env.TENANT_INGRESS_REQUIRE_SCOPE;

describe("processInboundEmailPayload tenant routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.computeIdempotencyKey.mockReturnValue("message-id:<msg-1>");
    mocks.createInboundEvent.mockResolvedValue({ id: "inbound-1", duplicate: false });
    mocks.markInboundProcessed.mockResolvedValue(undefined);
    mocks.markInboundFailed.mockResolvedValue(undefined);
    mocks.storeInboundEmail.mockResolvedValue({
      status: "created",
      messageId: "message-1",
      ticketId: "ticket-1",
      mailboxId: "mailbox-1"
    });
  });

  afterEach(() => {
    if (originalTenantIngressRequireScope === undefined) {
      delete process.env.TENANT_INGRESS_REQUIRE_SCOPE;
    } else {
      process.env.TENANT_INGRESS_REQUIRE_SCOPE = originalTenantIngressRequireScope;
    }
  });

  it("stamps inbound events and storage with the recipient mailbox tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_key: "tenant-a",
          workspace_key: "workspace-a",
          address: "support@tenant-a.example"
        }
      ]
    });

    const result = await processInboundEmailPayload({
      from: "customer@example.com",
      to: ["support@tenant-a.example"],
      subject: "Need help",
      text: "Hello",
      messageId: "<msg-1>"
    });

    expect(result.status).toBe(200);
    expect(mocks.createInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        idempotencyKey: "message-id:<msg-1>"
      })
    );
    expect(mocks.storeInboundEmail).toHaveBeenCalledWith(
      expect.any(Object),
      { tenantKey: "tenant-a", workspaceKey: "workspace-a" }
    );
    expect(mocks.markInboundProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "inbound-1",
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      })
    );
  });

  it("rejects ambiguous recipient routes before writing inbound state", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_key: "tenant-a",
          workspace_key: "workspace-a",
          address: "support@example.com"
        },
        {
          tenant_key: "tenant-b",
          workspace_key: "workspace-b",
          address: "support@example.com"
        }
      ]
    });

    const result = await processInboundEmailPayload({
      from: "customer@example.com",
      to: ["support@example.com"],
      subject: "Need help",
      text: "Hello",
      messageId: "<msg-1>"
    });

    expect(result).toMatchObject({
      status: 409,
      body: { error: "Ambiguous inbound tenant route" }
    });
    expect(mocks.createInboundEvent).not.toHaveBeenCalled();
    expect(mocks.storeInboundEmail).not.toHaveBeenCalled();
  });

  it("rejects unresolved recipient routes in strict mode before writing inbound state", async () => {
    process.env.TENANT_INGRESS_REQUIRE_SCOPE = "true";
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const result = await processInboundEmailPayload({
      from: "customer@example.com",
      to: ["unknown@example.com"],
      subject: "Need help",
      text: "Hello",
      messageId: "<msg-1>"
    });

    expect(result).toMatchObject({
      status: 404,
      body: {
        error: "Unresolved inbound tenant route",
        code: "unresolved_inbound_tenant_route"
      }
    });
    expect(mocks.createInboundEvent).not.toHaveBeenCalled();
    expect(mocks.storeInboundEmail).not.toHaveBeenCalled();
  });
});
