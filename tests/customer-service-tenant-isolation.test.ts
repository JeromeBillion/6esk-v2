import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const CUSTOMER_ID = "22222222-2222-2222-2222-222222222222";
const TICKET_ID = "11111111-1111-1111-1111-111111111111";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  attachCustomerToTicket,
  getCustomerById,
  listCustomerHistory,
  listCustomerIdentities
} from "@/server/customers";
import { reopenTicketIfNeeded } from "@/server/tickets";

describe("customer service tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("requires tenant scope for direct customer and identity reads", async () => {
    await getCustomerById(CUSTOMER_ID, TENANT_ID);
    await listCustomerIdentities(CUSTOMER_ID, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND tenant_id = $2"),
      [CUSTOMER_ID, TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND ci.tenant_id = $2"),
      [CUSTOMER_ID, TENANT_ID]
    );
  });

  it("keeps customer history queries inside the requested tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: CUSTOMER_ID,
            tenant_id: TENANT_ID,
            kind: "registered",
            external_system: null,
            external_user_id: null,
            display_name: "Customer",
            primary_email: "customer@example.com",
            primary_phone: null,
            address: null,
            merged_into_customer_id: null,
            merged_at: null
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await listCustomerHistory(CUSTOMER_ID, TENANT_ID, { limit: 10, cursor: null });

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND tenant_id = $2"),
      [CUSTOMER_ID, TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("AND t.tenant_id = $4"),
      [CUSTOMER_ID, ["customer@example.com"], [], TENANT_ID, null, 11]
    );
    expect(mocks.dbQuery.mock.calls[2][0]).toContain("m.tenant_id = t.tenant_id");
  });

  it("only attaches customers to tickets in the same tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await attachCustomerToTicket(TICKET_ID, CUSTOMER_ID, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND tenant_id = $3"),
      [TICKET_ID, CUSTOMER_ID, TENANT_ID]
    );
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("FROM customers c");
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("c.tenant_id = $3");
  });

  it("reopens tickets only inside the supplied tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ status: "closed" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await reopenTicketIfNeeded(TICKET_ID, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      "SELECT status FROM tickets WHERE id = $1 AND tenant_id = $2",
      [TICKET_ID, TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      "UPDATE tickets SET status = 'open', updated_at = now() WHERE id = $1 AND tenant_id = $2",
      [TICKET_ID, TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO ticket_events"),
      [TENANT_ID, TICKET_ID, "ticket_reopened", null, { previousStatus: "closed" }]
    );
  });
});
