import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

import { resolveOrCreateCustomerForInbound } from "@/server/customers";

function buildClient() {
  return {
    query: mocks.dbQuery,
    release: vi.fn()
  };
}

describe("resolveOrCreateCustomerForInbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("promotes an existing identity-matched customer instead of forking a new registered one", async () => {
    const client = buildClient();
    mocks.dbConnect.mockResolvedValue(client);
    mocks.dbQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "customer-existing", kind: "unregistered" }]
      })
      .mockResolvedValueOnce({ rows: [{ id: "customer-existing" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);

    const result = await resolveOrCreateCustomerForInbound({
      profile: {
        id: "user-123",
        email: "olivia.parker@brightpath.co",
        secondaryEmail: null,
        fullName: "Olivia Parker",
        phoneNumber: "+27821234567",
        kycStatus: "verified",
        accountStatus: "active"
      },
      inboundEmail: "olivia.parker@brightpath.co",
      displayName: "Olivia Parker"
    });

    expect(result).toEqual({
      customerId: "customer-existing",
      kind: "registered"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM customers"),
      ["prediction-market-mvp", "user-123"]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE customers"),
      expect.arrayContaining(["customer-existing", "prediction-market-mvp", "user-123"])
    );
    expect(
      mocks.dbQuery.mock.calls.some(
        ([sql]) =>
          typeof sql === "string" &&
          sql.includes("INSERT INTO customers") &&
          sql.includes("'registered'")
      )
    ).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it("keeps the canonical registered customer and reports a conflict when external ownership contradicts identity", async () => {
    const client = buildClient();
    mocks.dbConnect.mockResolvedValue(client);
    mocks.dbQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "customer-canonical",
            kind: "registered",
            external_system: "prediction-market-mvp",
            external_user_id: "user-999"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);

    const result = await resolveOrCreateCustomerForInbound({
      profile: {
        id: "user-123",
        email: "olivia.parker@brightpath.co",
        secondaryEmail: null,
        fullName: "Olivia Parker",
        phoneNumber: null,
        kycStatus: "verified",
        accountStatus: "active"
      },
      inboundEmail: "olivia.parker@brightpath.co",
      displayName: "Olivia Parker"
    });

    expect(result).toEqual({
      customerId: "customer-canonical",
      kind: "registered",
      conflict: {
        type: "external_identity_conflict",
        externalSystem: "prediction-market-mvp",
        incomingExternalUserId: "user-123",
        existingExternalUserId: "user-999",
        existingExternalSystem: "prediction-market-mvp",
        existingCustomerId: "customer-canonical",
        matchedIdentity: "email"
      }
    });
    expect(
      mocks.dbQuery.mock.calls.some(
        ([sql]) =>
          typeof sql === "string" &&
          (sql.includes("INSERT INTO customers") || sql.includes("UPDATE customers"))
      )
    ).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});
