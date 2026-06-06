import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  redactCallData: vi.fn((value) => value)
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/calls/redaction", () => ({
  redactCallData: mocks.redactCallData
}));

import { listAuditLogsForTicket } from "@/server/audit";

describe("listAuditLogsForTicket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({
      rows: [
        {
          id: "audit-1",
          action: "ticket_viewed",
          entity_type: "ticket",
          entity_id: "11111111-1111-1111-1111-111111111111",
          data: { ticketId: "11111111-1111-1111-1111-111111111111" },
          created_at: "2026-04-03T12:00:00.000Z",
          actor_name: "Jerome",
          actor_email: "jerome.choma@6ex.co.za"
        }
      ]
    });
  });

  it("casts ticketId to text when matching JSON audit payloads", async () => {
    const ticketId = "11111111-1111-1111-1111-111111111111";

    const result = await listAuditLogsForTicket(ticketId);

    expect(result).toHaveLength(1);
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("(a.data->>'ticketId') = $2::text");
    expect(values).toEqual(["00000000-0000-0000-0000-000000000001", ticketId, 50]);
  });

  it("keeps the legacy second-argument limit call shape working", async () => {
    const ticketId = "11111111-1111-1111-1111-111111111111";

    await listAuditLogsForTicket(ticketId, 25);

    const [, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(values).toEqual(["00000000-0000-0000-0000-000000000001", ticketId, 25]);
  });
});
