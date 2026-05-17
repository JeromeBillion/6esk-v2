import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getKnowledgeIngestionMetrics: vi.fn(),
  deliverPendingKnowledgeIngestionJobs: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/ai/knowledge-base", () => ({
  getKnowledgeIngestionMetrics: mocks.getKnowledgeIngestionMetrics
}));

vi.mock("@/server/ai/knowledge-ingestion-worker", () => ({
  deliverPendingKnowledgeIngestionJobs: mocks.deliverPendingKnowledgeIngestionJobs
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import {
  GET,
  POST
} from "@/app/api/admin/ai/knowledge/ingestion/route";

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

describe("admin AI knowledge ingestion API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KNOWLEDGE_INGESTION_SECRET;
    delete process.env.CRON_SECRET;
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.getKnowledgeIngestionMetrics.mockResolvedValue({
      queued: 1,
      dueNow: 1,
      running: 0,
      indexed24h: 2,
      failed: 0,
      poison: 0
    });
    mocks.deliverPendingKnowledgeIngestionJobs.mockResolvedValue({
      indexed: 1,
      failed: 0,
      poison: 0,
      total: 1
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns tenant-scoped ingestion metrics for admins", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      tenantId: TENANT_ID,
      queue: {
        queued: 1,
        indexed24h: 2
      }
    });
    expect(mocks.getKnowledgeIngestionMetrics).toHaveBeenCalledWith(TENANT_ID);
  });

  it("returns 403 for non-admin metrics reads", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.getKnowledgeIngestionMetrics).not.toHaveBeenCalled();
  });

  it("runs ingestion for only the admin tenant when triggered by an admin", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/ai/knowledge/ingestion?limit=7", {
        method: "POST"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", indexed: 1, total: 1 });
    expect(mocks.deliverPendingKnowledgeIngestionJobs).toHaveBeenCalledWith({
      limit: 7,
      tenantId: TENANT_ID
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "knowledge_ingestion_triggered"
      })
    );
  });

  it("allows secret-based worker triggers across tenants", async () => {
    process.env.KNOWLEDGE_INGESTION_SECRET = "knowledge-secret";
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/ai/knowledge/ingestion?limit=3", {
        method: "POST",
        headers: { "x-6esk-secret": "knowledge-secret" }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.deliverPendingKnowledgeIngestionJobs).toHaveBeenCalledWith({
      limit: 3,
      tenantId: null
    });
  });

  it("rejects unauthenticated worker triggers without a valid secret", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/ai/knowledge/ingestion", {
        method: "POST",
        headers: { "x-6esk-secret": "wrong" }
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.deliverPendingKnowledgeIngestionJobs).not.toHaveBeenCalled();
  });
});
