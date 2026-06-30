import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listKnowledgeBase: vi.fn(),
  createKnowledgeFolder: vi.fn(),
  uploadKnowledgeDocument: vi.fn(),
  publishKnowledgeDocument: vi.fn(),
  archiveKnowledgeDocument: vi.fn(),
  checkModuleEntitlement: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/ai/knowledge-base", async () => {
  const actual = await vi.importActual<typeof import("@/server/ai/knowledge-base")>(
    "@/server/ai/knowledge-base"
  );
  return {
    KnowledgeBaseError: actual.KnowledgeBaseError,
    listKnowledgeBase: mocks.listKnowledgeBase,
    createKnowledgeFolder: mocks.createKnowledgeFolder,
    uploadKnowledgeDocument: mocks.uploadKnowledgeDocument,
    publishKnowledgeDocument: mocks.publishKnowledgeDocument,
    archiveKnowledgeDocument: mocks.archiveKnowledgeDocument
  };
});

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/tenant/module-guard", () => ({
  checkModuleEntitlement: mocks.checkModuleEntitlement
}));

import { GET as getKnowledgeBase } from "@/app/api/admin/ai/knowledge/route";
import { PATCH as patchKnowledgeDocument } from "@/app/api/admin/ai/knowledge/documents/[documentId]/route";
import { POST as createKnowledgeFolderRoute } from "@/app/api/admin/ai/knowledge/folders/route";
import { POST as uploadKnowledgeDocumentRoute } from "@/app/api/admin/ai/knowledge/documents/route";

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

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/ai/knowledge/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("admin AI knowledge API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.listKnowledgeBase.mockResolvedValue({
      folders: [{ id: "folder-1", name: "SOPs" }],
      documents: [{ id: "doc-1", title: "Returns" }]
    });
    mocks.createKnowledgeFolder.mockResolvedValue({
      id: "folder-1",
      name: "SOPs",
      parent_folder_id: null,
      visibility: "ai_visible"
    });
    mocks.uploadKnowledgeDocument.mockResolvedValue({
      document: { id: "doc-1", title: "Returns SOP", folder_id: "folder-1" },
      version: {
        id: "version-1",
        original_filename: "returns.md",
        content_type: "text/markdown",
        size_bytes: 9
      },
      ingestionJob: { id: "job-1", status: "queued" }
    });
    mocks.publishKnowledgeDocument.mockResolvedValue({
      document: { id: "doc-1", status: "published" },
      version: { id: "version-1", status: "published" }
    });
    mocks.archiveKnowledgeDocument.mockResolvedValue({
      document: { id: "doc-1", status: "archived" }
    });
    mocks.checkModuleEntitlement.mockResolvedValue(true);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin knowledge listing", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await getKnowledgeBase();

    expect(response.status).toBe(403);
    expect(mocks.listKnowledgeBase).not.toHaveBeenCalled();
    expect(mocks.checkModuleEntitlement).not.toHaveBeenCalled();
  });

  it("returns 409 when the AI module is disabled", async () => {
    mocks.checkModuleEntitlement.mockResolvedValue(false);

    const response = await getKnowledgeBase();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "aiAutomation"
    });
    expect(mocks.listKnowledgeBase).not.toHaveBeenCalled();
    expect(mocks.checkModuleEntitlement).toHaveBeenCalledWith("aiAutomation", TENANT_ID);
  });

  it("lists the caller tenant knowledge base", async () => {
    const response = await getKnowledgeBase();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      tenantId: TENANT_ID,
      folders: [{ id: "folder-1" }],
      documents: [{ id: "doc-1" }]
    });
    expect(mocks.listKnowledgeBase).toHaveBeenCalledWith(TENANT_ID);
  });

  it("creates folders inside the caller tenant and records audit", async () => {
    const response = await createKnowledgeFolderRoute(
      jsonRequest({
        name: "SOPs",
        visibility: "ai_visible"
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ folder: { id: "folder-1", name: "SOPs" } });
    expect(mocks.createKnowledgeFolder).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      name: "SOPs",
      parentFolderId: null,
      description: null,
      visibility: "ai_visible"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "knowledge_folder_created",
        entityType: "knowledge_folder",
        entityId: "folder-1"
      })
    );
  });

  it("uploads documents inside the caller tenant and records audit", async () => {
    const formData = new FormData();
    formData.set("folderId", "folder-1");
    formData.set("title", "Returns SOP");
    formData.set("documentKind", "sop");
    formData.set("file", new File([Buffer.from("# Returns")], "returns.md", { type: "text/markdown" }));

    const response = await uploadKnowledgeDocumentRoute(
      new Request("http://localhost/api/admin/ai/knowledge/documents", {
        method: "POST",
        body: formData
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      document: { id: "doc-1" },
      version: { id: "version-1" },
      ingestionJob: { id: "job-1" }
    });
    expect(mocks.uploadKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        folderId: "folder-1",
        title: "Returns SOP",
        documentKind: "sop",
        fileName: "returns.md",
        contentType: "text/markdown",
        buffer: expect.any(Buffer)
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "knowledge_document_uploaded",
        entityType: "knowledge_document",
        entityId: "doc-1"
      })
    );
  });

  it("publishes indexed documents inside the caller tenant", async () => {
    const response = await patchKnowledgeDocument(
      new Request("http://localhost/api/admin/ai/knowledge/documents/doc-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "published" })
      }),
      { params: Promise.resolve({ documentId: "doc-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      document: { id: "doc-1", status: "published" },
      version: { id: "version-1", status: "published" }
    });
    expect(mocks.publishKnowledgeDocument).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      documentId: "doc-1"
    });
    expect(mocks.archiveKnowledgeDocument).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "knowledge_document_published",
        entityId: "doc-1",
        data: expect.objectContaining({
          status: "published",
          documentVersionId: "version-1"
        })
      })
    );
  });

  it("archives documents inside the caller tenant", async () => {
    const response = await patchKnowledgeDocument(
      new Request("http://localhost/api/admin/ai/knowledge/documents/doc-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived" })
      }),
      { params: Promise.resolve({ documentId: "doc-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.archiveKnowledgeDocument).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      documentId: "doc-1"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "knowledge_document_archived",
        entityId: "doc-1"
      })
    );
  });
});
