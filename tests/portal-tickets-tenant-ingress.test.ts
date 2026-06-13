import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAILBOX_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TICKET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MESSAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const mocks = vi.hoisted(() => ({
  tenantScopeFromPublicIngressRequest: vi.fn(),
  getOrCreateMailbox: vi.fn(),
  normalizeAddressList: vi.fn(),
  putObject: vi.fn(),
  createTicket: vi.fn(),
  addTagsToTicket: vi.fn(),
  inferTagsFromText: vi.fn(),
  recordTicketEvent: vi.fn(),
  buildAgentEvent: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  resolveOrCreateCustomerForInbound: vi.fn(),
  dbQuery: vi.fn(),
  runInBackground: vi.fn()
}));

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomUUID: () => MESSAGE_ID
  };
});

vi.mock("@/server/tenant-public-ingress", () => ({
  tenantScopeFromPublicIngressRequest: mocks.tenantScopeFromPublicIngressRequest,
  isTenantPublicIngressError: (error: unknown) =>
    Boolean(error && typeof error === "object" && "code" in error && "status" in error)
}));

vi.mock("@/server/email/mailbox", () => ({
  getOrCreateMailbox: mocks.getOrCreateMailbox
}));

vi.mock("@/server/email/normalize", () => ({
  normalizeAddressList: mocks.normalizeAddressList
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject
}));

vi.mock("@/server/tickets", () => ({
  createTicket: mocks.createTicket,
  addTagsToTicket: mocks.addTagsToTicket,
  inferTagsFromText: mocks.inferTagsFromText,
  recordTicketEvent: mocks.recordTicketEvent
}));

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  enqueueAgentEvent: mocks.enqueueAgentEvent,
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/customers", () => ({
  resolveOrCreateCustomerForInbound: mocks.resolveOrCreateCustomerForInbound
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/async", () => ({
  runInBackground: mocks.runInBackground
}));

import { POST } from "@/app/api/portal/tickets/route";

const ORIGINAL_ENV = { ...process.env };

function portalRequest(headers: Record<string, string> = {}) {
  return new Request("https://app.6esk.example/api/portal/tickets", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-portal-secret": "portal-secret",
      origin: "https://support.example.test",
      ...headers
    },
    body: JSON.stringify({
      from: "customer@example.test",
      subject: "Need help",
      description: "Please help with my order"
    })
  });
}

describe("/api/portal/tickets tenant public ingress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      PORTAL_SHARED_SECRET: "portal-secret",
      SUPPORT_ADDRESS: "support@6esk.example"
    };
    mocks.tenantScopeFromPublicIngressRequest.mockResolvedValue({
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });
    mocks.getOrCreateMailbox.mockResolvedValue({
      id: MAILBOX_ID,
      tenant_id: TENANT_ID
    });
    mocks.normalizeAddressList.mockReturnValue(["customer@example.test"]);
    mocks.inferTagsFromText.mockReturnValue(["billing"]);
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue({ customerId: "customer-1" });
    mocks.createTicket.mockResolvedValue(TICKET_ID);
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.addTagsToTicket.mockResolvedValue(undefined);
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mocks.putObject.mockResolvedValue("messages/body.txt");
    mocks.buildAgentEvent.mockImplementation((input) => ({ eventType: input.eventType, resource: input }));
    mocks.enqueueAgentEvent.mockResolvedValue(undefined);
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("creates portal tickets inside the origin-resolved tenant", async () => {
    const response = await POST(portalRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "created", ticketId: TICKET_ID, messageId: MESSAGE_ID });
    expect(mocks.tenantScopeFromPublicIngressRequest).toHaveBeenCalled();
    expect(mocks.getOrCreateMailbox).toHaveBeenCalledWith(
      "support@6esk.example",
      "support@6esk.example",
      TENANT_ID
    );
    expect(mocks.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        mailboxId: MAILBOX_ID,
        requesterEmail: "customer@example.test"
      })
    );
    expect(mocks.dbQuery.mock.calls[0][1][0]).toBe(TENANT_ID);
    expect(mocks.enqueueAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID })
    );
    expect(mocks.runInBackground).toHaveBeenCalledWith(
      expect.any(Promise),
      "Agent outbox delivery failed",
      expect.objectContaining({ tenantId: TENANT_ID, ticketId: TICKET_ID })
    );
  });

  it("rejects untrusted origins before tenant data writes", async () => {
    mocks.tenantScopeFromPublicIngressRequest.mockRejectedValue({
      code: "tenant_public_origin_untrusted",
      status: 403,
      message: "Public ingress origin is not trusted for any tenant workspace."
    });

    const response = await POST(portalRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      code: "tenant_public_origin_untrusted"
    });
    expect(mocks.getOrCreateMailbox).not.toHaveBeenCalled();
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });
});
