import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAuditLog: vi.fn(),
  listKnowledgeFolders: vi.fn(),
  createKnowledgeFolder: vi.fn(),
  exportKnowledgeBundle: vi.fn(),
  getKnowledgeIngestionReadiness: vi.fn(),
  listKnowledgeQuarantineEvents: vi.fn(),
  listKnowledgeRetrievalEvents: vi.fn(),
  runKnowledgeRetentionSweep: vi.fn(),
  setKnowledgeDocumentLegalHold: vi.fn(),
  retrieveKnowledge: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: (user: { role_name?: string | null } | null) => user?.role_name === "lead_admin"
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/ai/knowledge-base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/knowledge-base")>();
  return {
    ...actual,
    listKnowledgeFolders: mocks.listKnowledgeFolders,
    createKnowledgeFolder: mocks.createKnowledgeFolder,
    exportKnowledgeBundle: mocks.exportKnowledgeBundle,
    getKnowledgeIngestionReadiness: mocks.getKnowledgeIngestionReadiness,
    listKnowledgeQuarantineEvents: mocks.listKnowledgeQuarantineEvents,
    listKnowledgeRetrievalEvents: mocks.listKnowledgeRetrievalEvents,
    runKnowledgeRetentionSweep: mocks.runKnowledgeRetentionSweep,
    setKnowledgeDocumentLegalHold: mocks.setKnowledgeDocumentLegalHold,
    retrieveKnowledge: mocks.retrieveKnowledge
  };
});

import {
  GET as GET_FOLDERS,
  POST as POST_FOLDERS
} from "@/app/api/admin/ai/knowledge/folders/route";
import { GET as GET_QUARANTINE_EVENTS } from "@/app/api/admin/ai/knowledge/quarantine-events/route";
import { GET as GET_RETRIEVAL_EVENTS } from "@/app/api/admin/ai/knowledge/retrieval-events/route";
import {
  GET as GET_RETENTION,
  POST as POST_RETENTION
} from "@/app/api/admin/ai/knowledge/retention/route";
import { GET as GET_INGESTION_READINESS } from "@/app/api/admin/ai/knowledge/ingestion-readiness/route";
import { POST as POST_LEGAL_HOLD } from "@/app/api/admin/ai/knowledge/documents/[documentId]/legal-hold/route";
import { POST as POST_EXPORT } from "@/app/api/admin/ai/knowledge/export/route";
import { POST as POST_SEARCH } from "@/app/api/admin/ai/knowledge/search/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a"
  };
}

describe("admin AI knowledge APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.listKnowledgeFolders.mockResolvedValue([{ id: "folder-1", name: "SOPs" }]);
    mocks.createKnowledgeFolder.mockResolvedValue({ id: "folder-1", name: "SOPs", parent_id: null });
    mocks.getKnowledgeIngestionReadiness.mockReturnValue({
      ready: true,
      blockers: [],
      warnings: [],
      scanner: { status: "configured", required: true },
      extractor: { status: "configured" },
      quarantineStorage: { status: "configured" }
    });
    mocks.listKnowledgeQuarantineEvents.mockResolvedValue([{ id: "quarantine-1", filename: "bad.pdf" }]);
    mocks.listKnowledgeRetrievalEvents.mockResolvedValue([{ id: "event-1", query: "refund" }]);
    mocks.runKnowledgeRetentionSweep.mockResolvedValue({
      dryRun: true,
      matched: 0,
      deleted: 0,
      skippedLegalHold: 0,
      documents: []
    });
    mocks.setKnowledgeDocumentLegalHold.mockResolvedValue({
      id: "doc-1",
      filename: "held.md",
      title: "Held SOP"
    });
    mocks.exportKnowledgeBundle.mockResolvedValue({
      formatVersion: "ai-knowledge-export.v1",
      exportId: "export-1",
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      generatedAt: "2026-01-01T00:00:00.000Z",
      includeDeleted: false,
      includeBodyText: true,
      documentCount: 1,
      chunkCount: 1,
      folders: [],
      documents: []
    });
    mocks.retrieveKnowledge.mockResolvedValue([{ documentId: "doc-1", content: "Refund SOP" }]);
  });

  it("blocks non-admin folder access", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET_FOLDERS();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("creates folders for lead admins", async () => {
    const response = await POST_FOLDERS(
      new Request("http://localhost/api/admin/ai/knowledge/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "SOPs" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "created", folder: { name: "SOPs" } });
    expect(mocks.createKnowledgeFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        name: "SOPs"
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        action: "ai_knowledge_folder_created",
        entityType: "ai_knowledge_folder",
        entityId: "folder-1"
      })
    );
  });

  it("lists retrieval diagnostics inside the admin tenant scope", async () => {
    const response = await GET_RETRIEVAL_EVENTS(
      new Request("http://localhost/api/admin/ai/knowledge/retrieval-events?limit=10")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(mocks.listKnowledgeRetrievalEvents).toHaveBeenCalledWith(
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      },
      { limit: 10 }
    );
  });

  it("lists quarantine diagnostics inside the admin tenant scope", async () => {
    const response = await GET_QUARANTINE_EVENTS(
      new Request("http://localhost/api/admin/ai/knowledge/quarantine-events?limit=10")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(mocks.listKnowledgeQuarantineEvents).toHaveBeenCalledWith(
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      },
      { limit: 10 }
    );
  });

  it("returns knowledge ingestion readiness for lead admins", async () => {
    const response = await GET_INGESTION_READINESS();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.readiness).toMatchObject({ ready: true });
    expect(mocks.getKnowledgeIngestionReadiness).toHaveBeenCalled();
  });

  it("previews retention enforcement inside the admin tenant scope", async () => {
    const response = await GET_RETENTION(
      new Request("http://localhost/api/admin/ai/knowledge/retention?limit=10")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({ dryRun: true });
    expect(mocks.runKnowledgeRetentionSweep).toHaveBeenCalledWith(
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      },
      {
        dryRun: true,
        limit: 10
      }
    );
  });

  it("runs retention enforcement inside the admin tenant scope", async () => {
    mocks.runKnowledgeRetentionSweep.mockResolvedValueOnce({
      dryRun: false,
      matched: 1,
      deleted: 1,
      skippedLegalHold: 0,
      documents: [{ id: "doc-1", filename: "expired.md" }]
    });

    const response = await POST_RETENTION(
      new Request("http://localhost/api/admin/ai/knowledge/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 10 })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "completed", result: { deleted: 1 } });
    expect(mocks.runKnowledgeRetentionSweep).toHaveBeenCalledWith(
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      },
      {
        dryRun: false,
        limit: 10,
        actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
      }
    );
  });

  it("sets document legal hold inside the admin tenant scope", async () => {
    const response = await POST_LEGAL_HOLD(
      new Request("http://localhost/api/admin/ai/knowledge/documents/doc-1/legal-hold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legalHold: true, reason: "Investigation" })
      }),
      { params: Promise.resolve({ documentId: "doc-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "legal_hold_enabled", document: { id: "doc-1" } });
    expect(mocks.setKnowledgeDocumentLegalHold).toHaveBeenCalledWith({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      documentId: "doc-1",
      legalHold: true,
      reason: "Investigation",
      actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        action: "ai_knowledge_document_legal_hold_enabled",
        entityType: "ai_knowledge_document",
        entityId: "doc-1"
      })
    );
  });

  it("exports knowledge data inside the admin tenant scope with audit", async () => {
    const response = await POST_EXPORT(
      new Request("http://localhost/api/admin/ai/knowledge/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeDeleted: false, includeBodyText: true, limit: 25 })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "created", export: { exportId: "export-1" } });
    expect(mocks.exportKnowledgeBundle).toHaveBeenCalledWith(
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      },
      {
        includeDeleted: false,
        includeBodyText: true,
        limit: 25
      }
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        action: "ai_knowledge_export_created",
        entityType: "ai_knowledge_export",
        entityId: "export-1",
        data: expect.objectContaining({
          documentCount: 1,
          chunkCount: 1
        })
      })
    );
  });

  it("searches published knowledge for lead admins", async () => {
    const response = await POST_SEARCH(
      new Request("http://localhost/api/admin/ai/knowledge/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "refund", limit: 5 })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(mocks.retrieveKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        query: "refund",
        limit: 5
      })
    );
  });
});
