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

import { listAuditLogsForTicket, recordAuditLog, recordPlatformAuditLog } from "@/server/audit";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

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

    const result = await listAuditLogsForTicket(ticketId, TENANT_ID);

    expect(result).toHaveLength(1);
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("(a.data->>'ticketId') = $2::text");
    expect(sql).toContain("u.tenant_id = a.tenant_id");
    expect(values).toEqual([TENANT_ID, ticketId, 50]);
  });

  it("rejects audit log reads without tenant scope", async () => {
    const ticketId = "11111111-1111-1111-1111-111111111111";

    await expect(listAuditLogsForTicket(ticketId, null)).rejects.toThrow(
      "List ticket audit logs requires tenantId"
    );
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("records tenant audit logs only with explicit tenant scope", async () => {
    await recordAuditLog({
      tenantId: TENANT_ID,
      actorUserId: "user-1",
      action: "ticket_viewed",
      entityType: "ticket",
      entityId: "ticket-1",
      data: { ticketId: "ticket-1" }
    });

    const [, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(values).toEqual([
      TENANT_ID,
      "user-1",
      "ticket_viewed",
      "ticket",
      "ticket-1",
      { ticketId: "ticket-1" }
    ]);
  });

  it("rejects tenant audit writes without tenant scope", async () => {
    await expect(
      recordAuditLog({
        tenantId: null,
        actorUserId: "user-1",
        action: "ticket_viewed",
        entityType: "ticket"
      })
    ).rejects.toThrow("Record audit log requires tenantId");
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("requires platform audit callers to opt in explicitly", async () => {
    await recordPlatformAuditLog({
      actorUserId: null,
      action: "auth_login_failed",
      entityType: "auth_session",
      data: { reason: "unknown_user" }
    });

    const [, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(values).toEqual([
      DEFAULT_TENANT_ID,
      null,
      "auth_login_failed",
      "auth_session",
      null,
      { reason: "unknown_user", platformAudit: true }
    ]);
  });
});
