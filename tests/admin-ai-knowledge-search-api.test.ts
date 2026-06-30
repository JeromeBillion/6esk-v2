import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  checkModuleEntitlement: vi.fn(),
  retrievePublishedKnowledge: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/ai/knowledge-retrieval", () => ({
  retrievePublishedKnowledge: mocks.retrievePublishedKnowledge
}));

vi.mock("@/server/tenant/module-guard", () => ({
  checkModuleEntitlement: mocks.checkModuleEntitlement
}));

import { POST } from "@/app/api/admin/ai/knowledge/search/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: USER_ID,
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: TENANT_ID,
    tenant_slug: "default",
    real_tenant_id: TENANT_ID,
    is_impersonating: false
  };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/ai/knowledge/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("admin AI knowledge search API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.checkModuleEntitlement.mockResolvedValue(true);
    mocks.retrievePublishedKnowledge.mockResolvedValue({
      query: "return policy",
      citations: [],
      confidence: 0,
      outcome: "no_answer"
    });
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(request({ query: "return policy" }));

    expect(response.status).toBe(403);
    expect(mocks.retrievePublishedKnowledge).not.toHaveBeenCalled();
    expect(mocks.checkModuleEntitlement).not.toHaveBeenCalled();
  });

  it("returns 409 when the AI module is disabled", async () => {
    mocks.checkModuleEntitlement.mockResolvedValue(false);

    const response = await POST(request({ query: "return policy" }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "aiAutomation"
    });
    expect(mocks.retrievePublishedKnowledge).not.toHaveBeenCalled();
  });

  it("runs tenant-scoped published knowledge retrieval for admins", async () => {
    const response = await POST(
      request({
        query: "return policy",
        folderIds: ["44444444-4444-4444-4444-444444444444"],
        limit: 4,
        queryPurpose: "admin_test"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      query: "return policy",
      outcome: "no_answer"
    });
    expect(mocks.retrievePublishedKnowledge).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      query: "return policy",
        folderIds: ["44444444-4444-4444-4444-444444444444"],
        limit: 4,
        queryPurpose: "admin_test",
        excludeUnsafeContent: false
      });
  });

  it("can request unsafe-content exclusion for runtime-style diagnostics", async () => {
    const response = await POST(
      request({
        query: "return policy",
        excludeUnsafeContent: true
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.retrievePublishedKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        query: "return policy",
        excludeUnsafeContent: true
      })
    );
  });

  it("rejects invalid search payloads", async () => {
    const response = await POST(request({ query: "x", limit: 100 }));

    expect(response.status).toBe(400);
    expect(mocks.retrievePublishedKnowledge).not.toHaveBeenCalled();
  });
});
