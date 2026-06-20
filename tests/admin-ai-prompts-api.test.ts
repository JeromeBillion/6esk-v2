import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listAgentPromptTemplates: vi.fn(),
  createAgentPromptTemplateVersion: vi.fn(),
  activateAgentPromptTemplate: vi.fn(),
  rollbackAgentPromptTemplate: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/prompt-templates", () => ({
  listAgentPromptTemplates: mocks.listAgentPromptTemplates,
  createAgentPromptTemplateVersion: mocks.createAgentPromptTemplateVersion,
  activateAgentPromptTemplate: mocks.activateAgentPromptTemplate,
  rollbackAgentPromptTemplate: mocks.rollbackAgentPromptTemplate
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST as CREATE } from "@/app/api/admin/ai/prompts/route";
import { POST as ACTIVATE } from "@/app/api/admin/ai/prompts/[templateId]/activate/route";
import { POST as ROLLBACK } from "@/app/api/admin/ai/prompts/rollback/route";

function buildUser(roleName: "lead_admin" | "agent", tenantId = TENANT_ID) {
  return {
    id: USER_ID,
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: tenantId
  };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    tenant_id: TENANT_ID,
    workspace_id: null,
    template_key: "dexter_agent_runtime",
    template_version: "2026-06-20.agent-sandbox.v2",
    status: "active",
    template_body: { criticalConstraints: ["Use concise replies."] },
    template_hash: "hash-v2",
    ...overrides
  };
}

describe("admin AI prompt template API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.listAgentPromptTemplates.mockResolvedValue([template()]);
    mocks.createAgentPromptTemplateVersion.mockResolvedValue(template({ status: "draft" }));
    mocks.activateAgentPromptTemplate.mockResolvedValue(template());
    mocks.rollbackAgentPromptTemplate.mockResolvedValue(template({ template_version: "2026-06-19.agent-sandbox.v1" }));
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for tenantless lead admins before listing prompt templates", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", ""));

    const response = await GET(new Request("http://localhost/api/admin/ai/prompts"));

    expect(response.status).toBe(403);
    expect(mocks.listAgentPromptTemplates).not.toHaveBeenCalled();
  });

  it("lists tenant-scoped prompt templates", async () => {
    const response = await GET(new Request("http://localhost/api/admin/ai/prompts?limit=10"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.templates).toHaveLength(1);
    expect(mocks.listAgentPromptTemplates).toHaveBeenCalledWith({
      tenantId: TENANT_ID
    }, {
      templateKey: undefined,
      limit: 10
    });
  });

  it("creates and activates prompt template versions with audit evidence", async () => {
    const response = await CREATE(
      new Request("http://localhost/api/admin/ai/prompts", {
        method: "POST",
        body: JSON.stringify({
          templateVersion: "2026-06-20.agent-sandbox.v2",
          templateBody: { criticalConstraints: ["Use concise replies."] },
          activate: true,
          reason: "Release candidate"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.status).toBe("created_activated");
    expect(mocks.createAgentPromptTemplateVersion).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      templateVersion: "2026-06-20.agent-sandbox.v2",
      actorUserId: USER_ID,
      reason: "Release candidate"
    }));
    expect(mocks.activateAgentPromptTemplate).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      templateId: TEMPLATE_ID,
      actorUserId: USER_ID
    }));
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      action: "ai_prompt_template_created_activated",
      entityId: TEMPLATE_ID
    }));
  });

  it("activates an existing template inside the tenant scope", async () => {
    const response = await ACTIVATE(
      new Request(`http://localhost/api/admin/ai/prompts/${TEMPLATE_ID}/activate`, {
        method: "POST",
        body: JSON.stringify({ reason: "Promote after review" })
      }),
      { params: Promise.resolve({ templateId: TEMPLATE_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("activated");
    expect(mocks.activateAgentPromptTemplate).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      templateId: TEMPLATE_ID,
      actorUserId: USER_ID,
      reason: "Promote after review"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "ai_prompt_template_activated",
      tenantId: TENANT_ID,
      entityId: TEMPLATE_ID
    }));
  });

  it("rolls back to the most recent retired template", async () => {
    const response = await ROLLBACK(
      new Request("http://localhost/api/admin/ai/prompts/rollback", {
        method: "POST",
        body: JSON.stringify({ reason: "Regression found" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("rolled_back");
    expect(mocks.rollbackAgentPromptTemplate).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      templateKey: undefined,
      actorUserId: USER_ID,
      reason: "Regression found"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "ai_prompt_template_rolled_back",
      tenantId: TENANT_ID
    }));
  });
});
