import { beforeEach, describe, expect, it, vi } from "vitest";

const TICKET_1 = "11111111-1111-1111-1111-111111111111";
const TICKET_2 = "22222222-2222-2222-2222-222222222222";
const TICKET_3 = "33333333-3333-3333-3333-333333333333";
const TICKET_4 = "44444444-4444-4444-4444-444444444444";
const AGENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  getCustomerById: vi.fn(),
  listCustomerIdentities: vi.fn(),
  createOutboundEmailTicket: vi.fn(),
  recordTicketEvent: vi.fn(),
  recordAuditLog: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  isWorkspaceModuleEnabled: vi.fn(),
  recordModuleUsageEvent: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/customers", () => ({
  getCustomerById: mocks.getCustomerById,
  listCustomerIdentities: mocks.listCustomerIdentities
}));

vi.mock("@/server/tickets", () => ({
  recordTicketEvent: mocks.recordTicketEvent
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/agents/outbox", () => ({
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/tickets/outbound-email", () => ({
  createOutboundEmailTicket: mocks.createOutboundEmailTicket
}));

vi.mock("@/server/workspace-modules", () => ({
  DEFAULT_WORKSPACE_KEY: "primary",
  isWorkspaceModuleEnabled: mocks.isWorkspaceModuleEnabled
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: mocks.recordModuleUsageEvent
}));

import { POST } from "@/app/api/tickets/bulk-email/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer", id = AGENT_ID) {
  return {
    id,
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

function ticketRow(
  id: string,
  input?: Partial<{
    customer_id: string | null;
    requester_email: string;
    subject: string | null;
    assigned_user_id: string | null;
  }>
) {
  return {
    id,
    customer_id: `customer-${id}`,
    requester_email: `customer-${id}@example.com`,
    subject: `Subject ${id}`,
    assigned_user_id: AGENT_ID,
    ...input
  };
}

async function postBulkEmail(payload: Record<string, unknown>) {
  const request = new Request("http://localhost/api/tickets/bulk-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await POST(request);
  const body = await response.json();
  return { response, body };
}

describe("POST /api/tickets/bulk-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.recordTicketEvent.mockResolvedValue(undefined);
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.deliverPendingAgentEvents.mockResolvedValue(undefined);
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
    mocks.listCustomerIdentities.mockResolvedValue([]);
    mocks.getCustomerById.mockImplementation(async (customerId: string) => ({
      id: customerId,
      kind: "registered",
      external_system: null,
      external_user_id: null,
      display_name: customerId,
      primary_email: `${customerId}@example.com`,
      primary_phone: null,
      address: null,
      merged_into_customer_id: null,
      merged_at: null
    }));
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await postBulkEmail({
      ticketIds: [TICKET_1],
      subject: "Product update",
      text: "Hello"
    });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for viewer role", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("viewer"));

    const { response, body } = await postBulkEmail({
      ticketIds: [TICKET_1],
      subject: "Product update",
      text: "Hello"
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns 404 when any selected ticket is missing", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [ticketRow(TICKET_1)]
    });

    const { response, body } = await postBulkEmail({
      ticketIds: [TICKET_1, TICKET_2],
      subject: "Product update",
      text: "Hello"
    });

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      error: "Some tickets were not found.",
      missingTicketIds: [TICKET_2]
    });
  });

  it("returns 409 when the email module is disabled", async () => {
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(false);

    const { response, body } = await postBulkEmail({
      ticketIds: [TICKET_1],
      subject: "Product update",
      text: "Hello"
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "email"
    });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 403 when non-admin selects tickets not assigned to them", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [ticketRow(TICKET_1, { assigned_user_id: "different-agent-id" })]
    });

    const { response, body } = await postBulkEmail({
      ticketIds: [TICKET_1],
      subject: "Product update",
      text: "Hello"
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("creates tickets for unique resolved recipients and reports skipped/failed selections", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        ticketRow(TICKET_1, {
          customer_id: "customer-1",
          requester_email: "customer1@example.com",
          subject: "Alpha"
        }),
        ticketRow(TICKET_2, {
          customer_id: "customer-2",
          requester_email: "voice:+27123456789",
          subject: "Beta"
        }),
        ticketRow(TICKET_3, {
          customer_id: "customer-3",
          requester_email: "whatsapp:+27111111111",
          subject: "Gamma"
        }),
        ticketRow(TICKET_4, {
          customer_id: "customer-4",
          requester_email: "customer4@example.com",
          subject: "Delta"
        })
      ]
    });

    mocks.getCustomerById.mockImplementation(async (customerId: string) => {
      switch (customerId) {
        case "customer-1":
          return {
            id: customerId,
            kind: "registered",
            external_system: null,
            external_user_id: null,
            display_name: "Customer 1",
            primary_email: "shared@example.com",
            primary_phone: null,
            address: null,
            merged_into_customer_id: null,
            merged_at: null
          };
        case "customer-2":
          return {
            id: customerId,
            kind: "registered",
            external_system: null,
            external_user_id: null,
            display_name: "Customer 2",
            primary_email: "shared@example.com",
            primary_phone: null,
            address: null,
            merged_into_customer_id: null,
            merged_at: null
          };
        case "customer-3":
          return {
            id: customerId,
            kind: "registered",
            external_system: null,
            external_user_id: null,
            display_name: "Customer 3",
            primary_email: null,
            primary_phone: null,
            address: null,
            merged_into_customer_id: null,
            merged_at: null
          };
        case "customer-4":
          return {
            id: customerId,
            kind: "registered",
            external_system: null,
            external_user_id: null,
            display_name: "Customer 4",
            primary_email: "unique@example.com",
            primary_phone: null,
            address: null,
            merged_into_customer_id: null,
            merged_at: null
          };
        default:
          return null;
      }
    });
    mocks.listCustomerIdentities.mockResolvedValue([]);
    mocks.createOutboundEmailTicket
      .mockResolvedValueOnce({
        ticketId: "new-ticket-1",
        messageId: "message-1",
        mailboxId: "mailbox-1",
        category: "general",
        tags: []
      })
      .mockRejectedValueOnce(new Error("Resend request failed"));

    const { response, body } = await postBulkEmail({
      ticketIds: [TICKET_1, TICKET_2, TICKET_3, TICKET_4],
      subject: "Platform changes",
      text: "Please review the latest update."
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "partial",
      createdCount: 1,
      skippedCount: 2,
      failedCount: 1,
      createdTicketIds: ["new-ticket-1"]
    });

    expect(mocks.createOutboundEmailTicket).toHaveBeenCalledTimes(2);
    expect(mocks.createOutboundEmailTicket).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actorUserId: AGENT_ID,
        toEmail: "shared@example.com",
        customerId: "customer-1",
        deliverAgentEvents: false
      })
    );
    expect(mocks.createOutboundEmailTicket).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actorUserId: AGENT_ID,
        toEmail: "unique@example.com",
        customerId: "customer-4",
        deliverAgentEvents: false
      })
    );

    expect(body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceTicketId: TICKET_1,
          status: "created",
          recipientEmail: "shared@example.com",
          createdTicketId: "new-ticket-1"
        }),
        expect.objectContaining({
          sourceTicketId: TICKET_2,
          status: "skipped",
          recipientEmail: "shared@example.com"
        }),
        expect.objectContaining({
          sourceTicketId: TICKET_3,
          status: "skipped",
          recipientEmail: null
        }),
        expect.objectContaining({
          sourceTicketId: TICKET_4,
          status: "failed",
          recipientEmail: "unique@example.com",
          detail: "Resend request failed"
        })
      ])
    );

    expect(mocks.recordTicketEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditLog).toHaveBeenCalledTimes(2);
    expect(mocks.deliverPendingAgentEvents).toHaveBeenCalledTimes(1);
  });
});
