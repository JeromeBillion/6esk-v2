import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  dbQuery: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET as getSla, POST as postSla } from "@/app/api/admin/sla/route";
import { GET as getSpamRules, POST as postSpamRule } from "@/app/api/admin/spam-rules/route";
import {
  DELETE as deleteSpamRule,
  PATCH as patchSpamRule
} from "@/app/api/admin/spam-rules/[ruleId]/route";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function buildUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "admin@example.com",
    display_name: "Admin",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "lead_admin",
    tenant_id: TENANT_ID,
    ...overrides
  };
}

describe("admin config tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.isLeadAdmin.mockReturnValue(true);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("rejects admin-looking SLA reads without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser({ tenant_id: "" }));

    const response = await getSla();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("updates SLA configuration under the session tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ first_response_target_minutes: 60, resolution_target_minutes: 720 }]
      });

    const response = await postSla(
      new Request("https://desk.example.com/api/admin/sla", {
        method: "POST",
        body: JSON.stringify({ firstResponseMinutes: 60, resolutionMinutes: 720 })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      "UPDATE sla_configs SET is_active = false WHERE is_active = true AND tenant_id = $1",
      [TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("tenant_id"),
      [60, 720, TENANT_ID]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
  });

  it("lists and creates spam rules under the session tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const listResponse = await getSpamRules();

    expect(listResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = $1"), [
      TENANT_ID
    ]);

    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "rule-1",
          rule_type: "block",
          scope: "domain",
          pattern: "spam.example",
          is_active: true,
          created_at: "2026-06-13T00:00:00.000Z"
        }
      ]
    });

    const createResponse = await postSpamRule(
      new Request("https://desk.example.com/api/admin/spam-rules", {
        method: "POST",
        body: JSON.stringify({ ruleType: "block", scope: "domain", pattern: "Spam.Example" })
      })
    );

    expect(createResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO spam_rules (rule_type, scope, pattern, tenant_id)"),
      ["block", "domain", "spam.example", TENANT_ID]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID }));
  });

  it("updates and deletes spam rules only under the session tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "rule-1",
          rule_type: "block",
          scope: "sender",
          pattern: "bad@example.com",
          is_active: false,
          created_at: "2026-06-13T00:00:00.000Z"
        }
      ]
    });

    const patchResponse = await patchSpamRule(
      new Request("https://desk.example.com/api/admin/spam-rules/rule-1", {
        method: "PATCH",
        body: JSON.stringify({ isActive: false })
      }),
      { params: Promise.resolve({ ruleId: "rule-1" }) }
    );

    expect(patchResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("AND tenant_id = $3"), [
      false,
      "rule-1",
      TENANT_ID
    ]);

    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: "rule-1" }] });

    const deleteResponse = await deleteSpamRule(new Request("https://desk.example.com"), {
      params: Promise.resolve({ ruleId: "rule-1" })
    });

    expect(deleteResponse.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenLastCalledWith(
      "DELETE FROM spam_rules WHERE id = $1 AND tenant_id = $2 RETURNING id",
      ["rule-1", TENANT_ID]
    );
  });
});
