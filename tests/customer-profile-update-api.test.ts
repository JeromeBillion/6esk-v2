import { beforeEach, describe, expect, it, vi } from "vitest";

const CUSTOMER_ID = "22222222-2222-2222-2222-222222222222";
const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const mocks = vi.hoisted(() => {
  class CustomerIdentityConflictError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CustomerIdentityConflictError";
    }
  }

  return {
    getSessionUser: vi.fn(),
    getCustomerById: vi.fn(),
    updateCustomerProfile: vi.fn(),
    listCustomerIdentities: vi.fn(),
    recordAuditLog: vi.fn(),
    dbQuery: vi.fn(),
    CustomerIdentityConflictError
  };
});

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/customers", () => ({
  CustomerIdentityConflictError: mocks.CustomerIdentityConflictError,
  getCustomerById: mocks.getCustomerById,
  updateCustomerProfile: mocks.updateCustomerProfile,
  listCustomerIdentities: mocks.listCustomerIdentities
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { PATCH } from "@/app/api/customers/[customerId]/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: TENANT_ID,
    tenant_slug: "default"
  };
}

function buildCustomer(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: CUSTOMER_ID,
    kind: "registered",
    external_system: "prediction-market-mvp",
    external_user_id: "user-123",
    display_name: "John Davidson",
    primary_email: "john@techcorp.com",
    primary_phone: "+27710000001",
    merged_into_customer_id: null,
    merged_at: null,
    ...overrides
  };
}

async function patchCustomer(payload: Record<string, unknown>) {
  const request = new Request(`http://localhost/api/customers/${CUSTOMER_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await PATCH(request, { params: Promise.resolve({ customerId: CUSTOMER_ID }) });
  const body = await response.json();
  return { response, body };
}

describe("PATCH /api/customers/[customerId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.getCustomerById.mockResolvedValue(buildCustomer());
    mocks.updateCustomerProfile.mockResolvedValue(
      buildCustomer({
        display_name: "John D.",
        primary_email: "john.d@techcorp.com",
        primary_phone: "+27710000009"
      })
    );
    mocks.listCustomerIdentities.mockResolvedValue([
      { identity_type: "email", identity_value: "john.d@techcorp.com", is_primary: true },
      { identity_type: "phone", identity_value: "+27710000009", is_primary: true }
    ]);
    mocks.dbQuery.mockResolvedValue({ rowCount: 1, rows: [{ id: TICKET_ID }] });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await patchCustomer({
      displayName: "John D.",
      ticketId: TICKET_ID
    });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.getCustomerById).not.toHaveBeenCalled();
  });

  it("returns 403 for viewer role", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("viewer"));

    const { response, body } = await patchCustomer({
      displayName: "John D.",
      ticketId: TICKET_ID
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.updateCustomerProfile).not.toHaveBeenCalled();
  });

  it("requires ticketId for non-admin updates", async () => {
    const { response, body } = await patchCustomer({
      displayName: "John D."
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "ticketId is required for customer profile updates."
    });
    expect(mocks.updateCustomerProfile).not.toHaveBeenCalled();
  });

  it("returns 403 when non-admin user cannot access the ticket context", async () => {
    mocks.dbQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    const { response, body } = await patchCustomer({
      displayName: "John D.",
      ticketId: TICKET_ID
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.updateCustomerProfile).not.toHaveBeenCalled();
  });

  it("updates customer profile, normalizes fields, and records audit changes", async () => {
    const { response, body } = await patchCustomer({
      displayName: "  John D.  ",
      primaryEmail: " JOHN.D@TECHCORP.COM ",
      primaryPhone: " +27 710 000 009 ",
      ticketId: TICKET_ID
    });

    expect(response.status).toBe(200);
    expect(body.customer).toMatchObject({
      id: CUSTOMER_ID,
      display_name: "John D.",
      primary_email: "john.d@techcorp.com",
      primary_phone: "+27710000009"
    });
    expect(body.customer.identities).toEqual([
      { type: "email", value: "john.d@techcorp.com", isPrimary: true },
      { type: "phone", value: "+27710000009", isPrimary: true }
    ]);
    expect(mocks.getCustomerById).toHaveBeenCalledWith(CUSTOMER_ID, TENANT_ID);
    expect(mocks.updateCustomerProfile).toHaveBeenCalledWith(
      CUSTOMER_ID,
      TENANT_ID,
      {
        displayName: "John D.",
        primaryEmail: "john.d@techcorp.com",
        primaryPhone: "+27 710 000 009"
      }
    );
    expect(mocks.listCustomerIdentities).toHaveBeenCalledWith(CUSTOMER_ID, TENANT_ID);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      action: "customer_profile_updated",
      entityType: "customer",
      entityId: CUSTOMER_ID,
      data: {
        ticketId: TICKET_ID,
        changes: {
          displayName: { from: "John Davidson", to: "John D." },
          primaryEmail: { from: "john@techcorp.com", to: "john.d@techcorp.com" },
          primaryPhone: { from: "+27710000001", to: "+27710000009" }
        }
      }
    });
  });

  it("maps identity conflicts to HTTP 409", async () => {
    mocks.updateCustomerProfile.mockRejectedValue(
      new mocks.CustomerIdentityConflictError("Email already belongs to a different customer.")
    );

    const { response, body } = await patchCustomer({
      primaryEmail: "conflict@example.com",
      ticketId: TICKET_ID
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "Email already belongs to a different customer."
    });
  });

  it("allows lead admin update without ticket context", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const { response } = await patchCustomer({
      displayName: "John D."
    });

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
    expect(mocks.updateCustomerProfile).toHaveBeenCalledWith(
      CUSTOMER_ID,
      TENANT_ID,
      {
        displayName: "John D."
      }
    );
  });
});
