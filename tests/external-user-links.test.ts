import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  deriveMatchConfidence,
  findExternalUserLinkByIdentity,
  normalizeLinkEmail,
  normalizeLinkPhone,
  upsertExternalUserLink
} from "@/server/integrations/external-user-links";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

describe("external user link helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("normalizes emails to lowercase", () => {
    expect(normalizeLinkEmail("  User@Example.com ")).toBe("user@example.com");
    expect(normalizeLinkEmail("")).toBeNull();
    expect(normalizeLinkEmail(undefined)).toBeNull();
  });

  test("normalizes phones to compact format", () => {
    expect(normalizeLinkPhone(" +27 71 234 5678 ")).toBe("+27712345678");
    expect(normalizeLinkPhone("(071) 234-5678")).toBe("0712345678");
    expect(normalizeLinkPhone("")).toBeNull();
  });

  test("maps confidence from known match strategies", () => {
    expect(deriveMatchConfidence("email")).toBe(1);
    expect(deriveMatchConfidence("secondary_email")).toBe(1);
    expect(deriveMatchConfidence("phone_number")).toBe(1);
    expect(deriveMatchConfidence("closed_email_primary")).toBe(0.7);
    expect(deriveMatchConfidence("unknown")).toBeNull();
  });

  test("returns null without querying when no normalized identity is provided", async () => {
    const result = await findExternalUserLinkByIdentity({
      tenantId: TENANT_ID,
      externalSystem: "external-profile",
      email: " ",
      phone: " "
    });

    expect(result).toBeNull();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  test("queries by normalized identity and returns best match row", async () => {
    const row = {
      tenant_id: TENANT_ID,
      external_system: "external-profile",
      external_user_id: "user-123",
      email: "user@example.com",
      phone: "+27710000001",
      matched_by: "email",
      confidence: 1,
      last_seen_at: new Date().toISOString(),
      last_ticket_id: "ticket-1",
      last_channel: "email"
    };
    mocks.dbQuery.mockResolvedValue({ rows: [row] });

    const result = await findExternalUserLinkByIdentity({
      tenantId: TENANT_ID,
      externalSystem: "external-profile",
      email: "  USER@example.com ",
      phone: " +27 71 000 0001 "
    });

    expect(result).toEqual(row);
    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE tenant_id = $1");
    expect(values).toEqual([
      TENANT_ID,
      "external-profile",
      "user@example.com",
      "+27710000001"
    ]);
  });

  test("can write through a transaction client instead of the global pool", async () => {
    const queryExecutor = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await upsertExternalUserLink({
      tenantId: TENANT_ID,
      externalSystem: "external-profile",
      profile: {
        id: "user-123",
        email: "User@Example.com",
        secondaryEmail: null,
        fullName: null,
        phoneNumber: null,
        kycStatus: null,
        accountStatus: null
      },
      matchedBy: "email",
      inboundEmail: "user@example.com",
      ticketId: "ticket-1",
      channel: "email",
      queryExecutor
    });

    expect(queryExecutor.query).toHaveBeenCalledTimes(1);
    const [sql, values] = queryExecutor.query.mock.calls[0] ?? [];
    expect(sql).toContain("tenant_id");
    expect(sql).toContain("ON CONFLICT (tenant_id, external_system, external_user_id)");
    expect(values?.[0]).toBe(TENANT_ID);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
