import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getKnowledgeIngestionMetrics: vi.fn(),
  getKnowledgeIngestionReadiness: vi.fn(),
  listKnowledgeQuarantineEvents: vi.fn(),
  deliverPendingKnowledgeIngestionJobs: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/ai/knowledge-base", () => ({
  getKnowledgeIngestionMetrics: mocks.getKnowledgeIngestionMetrics,
  getKnowledgeIngestionReadiness: mocks.getKnowledgeIngestionReadiness,
  listKnowledgeQuarantineEvents: mocks.listKnowledgeQuarantineEvents
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
import { GET as GET_QUARANTINE_EVENTS } from "@/app/api/admin/ai/knowledge/quarantine-events/route";

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
    mocks.getKnowledgeIngestionReadiness.mockReturnValue({
      ready: true,
      blockers: [],
      warnings: [],
      scanner: { status: "configured" },
      extractor: { status: "configured" },
      quarantineStorage: { status: "optional_disabled" }
    });
    mocks.listKnowledgeQuarantineEvents.mockResolvedValue([
      {
        id: "quarantine-1",
        tenant_id: TENANT_ID,
        original_filename: "bad.pdf",
        reason_code: "knowledge_extractor_unconfigured"
      }
    ]);
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
      },
      readiness: {
        ready: true,
        scanner: { status: "configured" }
      }
    });
    expect(mocks.getKnowledgeIngestionMetrics).toHaveBeenCalledWith(TENANT_ID);
    expect(mocks.getKnowledgeIngestionReadiness).toHaveBeenCalled();
  });

  it("returns 403 for non-admin metrics reads", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.getKnowledgeIngestionMetrics).not.toHaveBeenCalled();
  });

  it("lists tenant-scoped quarantine events for admins", async () => {
    const response = await GET_QUARANTINE_EVENTS(
      new Request("http://localhost/api/admin/ai/knowledge/quarantine-events?limit=7")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      tenantId: TENANT_ID,
      events: [
        {
          id: "quarantine-1",
          original_filename: "bad.pdf",
          reason_code: "knowledge_extractor_unconfigured"
        }
      ]
    });
    expect(mocks.listKnowledgeQuarantineEvents).toHaveBeenCalledWith(TENANT_ID, { limit: 7 });
  });

  it("returns 403 for non-admin quarantine diagnostics reads", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET_QUARANTINE_EVENTS(
      new Request("http://localhost/api/admin/ai/knowledge/quarantine-events")
    );

    expect(response.status).toBe(403);
    expect(mocks.listKnowledgeQuarantineEvents).not.toHaveBeenCalled();
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
