import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrCreateMailbox: vi.fn(),
  inferTagsFromText: vi.fn(),
  createTicket: vi.fn(),
  recordTicketEvent: vi.fn(),
  addTagsToTicket: vi.fn(),
  resolveOrCreateCustomerForInbound: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  putObject: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/email/mailbox", () => ({
  getOrCreateMailbox: mocks.getOrCreateMailbox
}));

vi.mock("@/server/tickets", () => ({
  addTagsToTicket: mocks.addTagsToTicket,
  createTicket: mocks.createTicket,
  inferTagsFromText: mocks.inferTagsFromText,
  recordTicketEvent: mocks.recordTicketEvent
}));

vi.mock("@/server/customers", () => ({
  resolveOrCreateCustomerForInbound: mocks.resolveOrCreateCustomerForInbound
}));

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  enqueueAgentEvent: mocks.enqueueAgentEvent,
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { POST } from "@/app/api/portal/tickets/route";

const ORIGINAL_ENV = { ...process.env };

function mappedEnv() {
  return {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    SUPPORT_ADDRESS: "support@6ex.co.za",
    TENANT_PUBLIC_INGRESS_REQUIRE_ORIGIN: "true",
    TENANT_PUBLIC_INGRESS_ORIGINS_JSON: JSON.stringify({
      "https://support.example.com": {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      }
    })
  };
}

function portalRequest(origin = "https://support.example.com") {
  return new Request("http://localhost/api/portal/tickets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin
    },
    body: JSON.stringify({
      from: "customer@example.com",
      subject: "Need help",
      description: "Please help with my account.",
      metadata: { sourceDetail: "help-center" }
    })
  });
}

describe("POST /api/portal/tickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = mappedEnv();
    mocks.getOrCreateMailbox.mockResolvedValue({ id: "mailbox-1" });
    mocks.inferTagsFromText.mockReturnValue(["general"]);
    mocks.createTicket.mockResolvedValue("ticket-1");
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.addTagsToTicket.mockResolvedValue(undefined);
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue({ customerId: "customer-1" });
    mocks.buildAgentEvent.mockImplementation((payload) => ({
      id: `evt-${String(payload.eventType)}`,
      ...payload
    }));
    mocks.enqueueAgentEvent.mockResolvedValue(undefined);
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
    mocks.putObject.mockResolvedValue("tenants/tenant-a/workspaces/workspace-a/messages/message-1/body.txt");
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("fails closed before writing when strict public ingress has no trusted origin", async () => {
    process.env = {
      ...mappedEnv(),
      TENANT_PUBLIC_INGRESS_ORIGINS_JSON: JSON.stringify({})
    };

    const response = await POST(portalRequest("https://unknown.example.com"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      code: "tenant_public_origin_untrusted"
    });
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });

  it("creates portal tickets inside the mapped tenant workspace", async () => {
    const response = await POST(portalRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "created",
      ticketId: "ticket-1"
    });
    expect(mocks.getOrCreateMailbox).toHaveBeenCalledWith("support@6ex.co.za", "support@6ex.co.za", {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    expect(mocks.resolveOrCreateCustomerForInbound).toHaveBeenCalledWith({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      inboundEmail: "customer@example.com"
    });
    expect(mocks.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        mailboxId: "mailbox-1",
        customerId: "customer-1",
        requesterEmail: "customer@example.com"
      })
    );
    expect(mocks.addTagsToTicket).toHaveBeenCalledWith("ticket-1", ["general"], {
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("tenant_key, workspace_key"),
      expect.arrayContaining(["tenant-a", "workspace-a"])
    );
    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining("tenants/tenant-a/workspaces/workspace-a/messages/")
      })
    );
    expect(mocks.enqueueAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ticket.created",
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      })
    );
  });
});
