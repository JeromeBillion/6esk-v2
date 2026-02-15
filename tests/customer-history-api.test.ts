import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_AGENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const CUSTOMER_ID = "22222222-2222-2222-2222-222222222222";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTicketById: vi.fn(),
  resolveOrCreateCustomerForInbound: vi.fn(),
  attachCustomerToTicket: vi.fn(),
  getCustomerById: vi.fn(),
  listCustomerHistory: vi.fn(),
  listCustomerIdentities: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/tickets", () => ({
  getTicketById: mocks.getTicketById
}));

vi.mock("@/server/customers", () => ({
  resolveOrCreateCustomerForInbound: mocks.resolveOrCreateCustomerForInbound,
  attachCustomerToTicket: mocks.attachCustomerToTicket,
  getCustomerById: mocks.getCustomerById,
  listCustomerHistory: mocks.listCustomerHistory,
  listCustomerIdentities: mocks.listCustomerIdentities
}));

import { GET } from "@/app/api/tickets/[ticketId]/customer-history/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer" = "agent", userId = AGENT_ID) {
  return {
    id: userId,
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    role_name: roleName
  };
}

function buildTicket(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: TICKET_ID,
    assigned_user_id: AGENT_ID,
    customer_id: CUSTOMER_ID,
    requester_email: "known.user@example.com",
    ...overrides
  };
}

function buildCustomer(id = CUSTOMER_ID) {
  return {
    id,
    kind: "registered",
    external_system: "prediction-market-mvp",
    external_user_id: "pm-user-123",
    display_name: "Known User",
    primary_email: "known.user@example.com",
    primary_phone: "+27710000001",
    merged_into_customer_id: null,
    merged_at: null
  };
}

async function getCustomerHistory(url = `http://localhost/api/tickets/${TICKET_ID}/customer-history`) {
  const response = await GET(new Request(url), {
    params: Promise.resolve({ ticketId: TICKET_ID })
  });
  const body = await response.json();
  return { response, body };
}

describe("GET /api/tickets/[ticketId]/customer-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.getTicketById.mockResolvedValue(buildTicket());
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue(null);
    mocks.attachCustomerToTicket.mockResolvedValue(true);
    mocks.getCustomerById.mockResolvedValue(buildCustomer());
    mocks.listCustomerIdentities.mockResolvedValue([
      { identity_type: "email", identity_value: "known.user@example.com", is_primary: true }
    ]);
    mocks.listCustomerHistory.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await getCustomerHistory();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.getTicketById).not.toHaveBeenCalled();
  });

  it("returns 403 when non-admin user is not assigned to the ticket", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent", AGENT_ID));
    mocks.getTicketById.mockResolvedValue(buildTicket({ assigned_user_id: OTHER_AGENT_ID }));

    const { response, body } = await getCustomerHistory();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.listCustomerHistory).not.toHaveBeenCalled();
  });

  it("allows lead admin access and clamps limit to 100", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", OTHER_AGENT_ID));
    mocks.listCustomerHistory.mockResolvedValue({
      items: [
        {
          ticketId: TICKET_ID,
          subject: "Escalated issue",
          status: "open",
          priority: "high",
          requesterEmail: "known.user@example.com",
          channel: "email",
          lastMessageAt: "2026-02-15T08:00:00.000Z",
          lastCustomerInboundPreview: "Please escalate this issue urgently.",
          lastCustomerInboundAt: "2026-02-15T07:58:00.000Z"
        }
      ],
      nextCursor: "2026-02-14T08:00:00.000Z"
    });

    const { response, body } = await getCustomerHistory(
      `http://localhost/api/tickets/${TICKET_ID}/customer-history?limit=999&cursor=2026-02-14T08:00:00.000Z`
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      customer: expect.objectContaining({
        id: CUSTOMER_ID,
        display_name: "Known User"
      }),
      nextCursor: "2026-02-14T08:00:00.000Z"
    });
    expect(body.history).toHaveLength(1);
    expect(body.customer.identities[0]).toMatchObject({
      type: "email",
      value: "known.user@example.com",
      isPrimary: true
    });
    expect(mocks.listCustomerHistory).toHaveBeenCalledWith(CUSTOMER_ID, {
      limit: 100,
      cursor: "2026-02-14T08:00:00.000Z"
    });
  });

  it("auto-resolves customer for tickets missing customer_id and attaches linkage", async () => {
    mocks.getTicketById.mockResolvedValue(
      buildTicket({
        customer_id: null,
        requester_email: "unregistered@example.com"
      })
    );
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue({
      customerId: CUSTOMER_ID,
      kind: "unregistered"
    });

    const { response, body } = await getCustomerHistory();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      customer: expect.objectContaining({ id: CUSTOMER_ID }),
      history: []
    });
    expect(mocks.resolveOrCreateCustomerForInbound).toHaveBeenCalledWith({
      inboundEmail: "unregistered@example.com",
      inboundPhone: null
    });
    expect(mocks.attachCustomerToTicket).toHaveBeenCalledWith(TICKET_ID, CUSTOMER_ID);
    expect(mocks.listCustomerHistory).toHaveBeenCalledWith(CUSTOMER_ID, { limit: 30, cursor: null });
  });

  it("uses WhatsApp requester number for auto-resolution when ticket requester is whatsapp", async () => {
    mocks.getTicketById.mockResolvedValue(
      buildTicket({
        customer_id: null,
        requester_email: "whatsapp:+27731234567"
      })
    );
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue({
      customerId: CUSTOMER_ID,
      kind: "unregistered"
    });

    const { response, body } = await getCustomerHistory();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      customer: expect.objectContaining({ id: CUSTOMER_ID })
    });
    expect(mocks.resolveOrCreateCustomerForInbound).toHaveBeenCalledWith({
      inboundEmail: null,
      inboundPhone: "+27731234567"
    });
    expect(mocks.attachCustomerToTicket).toHaveBeenCalledWith(TICKET_ID, CUSTOMER_ID);
  });

  it("returns empty customer/history when customer cannot be resolved", async () => {
    mocks.getTicketById.mockResolvedValue(
      buildTicket({
        customer_id: null,
        requester_email: "unknown@example.com"
      })
    );
    mocks.resolveOrCreateCustomerForInbound.mockResolvedValue(null);

    const { response, body } = await getCustomerHistory();

    expect(response.status).toBe(200);
    expect(body).toEqual({ customer: null, history: [], nextCursor: null });
    expect(mocks.listCustomerHistory).not.toHaveBeenCalled();
    expect(mocks.getCustomerById).not.toHaveBeenCalled();
  });
});
