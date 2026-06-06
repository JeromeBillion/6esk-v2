import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => {
  const client = {
    query: vi.fn(),
    release: vi.fn()
  };

  return {
    db: {
      query: vi.fn(),
      connect: vi.fn()
    },
    client,
    putObject: vi.fn(),
    deleteObject: vi.fn()
  };
});

vi.mock("@/server/db", () => ({
  db: mocks.db
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject,
  deleteObject: mocks.deleteObject
}));

import {
  archiveKnowledgeDocument,
  createKnowledgeFolder,
  KnowledgeBaseError,
  listKnowledgeBase,
  publishKnowledgeDocument,
  uploadKnowledgeDocument
} from "@/server/ai/knowledge-base";

describe("knowledge base service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.connect.mockResolvedValue(mocks.client);
    mocks.putObject.mockResolvedValue("stored-key");
    mocks.deleteObject.mockResolvedValue(undefined);
  });

  it("lists folders and documents inside the caller tenant", async () => {
    mocks.db.query
      .mockResolvedValueOnce({ rows: [{ id: "folder-1", name: "SOPs" }] })
      .mockResolvedValueOnce({ rows: [{ id: "doc-1", title: "Returns" }] });

    const result = await listKnowledgeBase(TENANT_ID);

    expect(result).toEqual({
      folders: [{ id: "folder-1", name: "SOPs" }],
      documents: [{ id: "doc-1", title: "Returns" }]
    });
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE tenant_id = $1"),
      [TENANT_ID]
    );
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("WHERE d.tenant_id = $1"),
      [TENANT_ID]
    );
  });

  it("checks parent folder ownership before creating a child folder", async () => {
    const parentFolderId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    mocks.db.query
      .mockResolvedValueOnce({ rows: [{ id: parentFolderId }] })
      .mockResolvedValueOnce({
        rows: [{ id: "folder-2", name: "Escalations", parent_folder_id: parentFolderId }]
      });

    const folder = await createKnowledgeFolder({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      name: "Escalations",
      parentFolderId
    });

    expect(folder).toMatchObject({ id: "folder-2", parent_folder_id: parentFolderId });
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE tenant_id = $1"),
      [TENANT_ID, parentFolderId]
    );
    expect(mocks.db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO knowledge_folders"),
      [TENANT_ID, parentFolderId, "Escalations", null, "ai_visible", USER_ID]
    );
  });

  it("does not store uploads when the selected folder is outside the tenant", async () => {
    mocks.db.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      uploadKnowledgeDocument({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        folderId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        fileName: "returns.md",
        contentType: "text/markdown",
        buffer: Buffer.from("# Returns")
      })
    ).rejects.toMatchObject({ code: "FOLDER_NOT_FOUND" });

    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.db.connect).not.toHaveBeenCalled();
  });

  it("stores the object and registers document, version, and ingestion job in one transaction", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "doc-1", title: "Returns SOP", folder_id: null }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: "version-1",
          document_id: "doc-1",
          original_filename: "returns.md",
          content_type: "text/markdown",
          size_bytes: 9
        }]
      })
      .mockResolvedValueOnce({ rows: [{ id: "job-1", status: "queued" }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await uploadKnowledgeDocument({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      title: "Returns SOP",
      fileName: "returns.md",
      contentType: "text/markdown",
      buffer: Buffer.from("# Returns")
    });

    expect(result).toMatchObject({
      document: { id: "doc-1" },
      version: { id: "version-1" },
      ingestionJob: { id: "job-1" }
    });
    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining(`tenants/${TENANT_ID}/ai-knowledge/`),
        contentType: "text/markdown"
      })
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO knowledge_documents"),
      expect.arrayContaining([TENANT_ID, null, "Returns SOP", "sop", USER_ID])
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO knowledge_document_versions"),
      expect.arrayContaining([TENANT_ID, expect.any(String), "returns.md", "text/markdown"])
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("INSERT INTO knowledge_ingestion_jobs"),
      expect.arrayContaining([TENANT_ID, expect.any(String)])
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(5, "COMMIT");
    expect(mocks.client.release).toHaveBeenCalled();
  });

  it("rejects unsupported file types before object storage", async () => {
    await expect(
      uploadKnowledgeDocument({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        fileName: "malware.exe",
        contentType: "application/octet-stream",
        buffer: Buffer.from("bad")
      })
    ).rejects.toBeInstanceOf(KnowledgeBaseError);

    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("publishes only the latest indexed version inside the tenant", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "doc-1" }] })
      .mockResolvedValueOnce({
        rows: [{
          id: "version-2",
          document_id: "doc-1",
          version_number: 2,
          status: "indexed"
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "version-2", document_id: "doc-1", status: "published" }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: "doc-1", status: "published", title: "Returns SOP" }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await publishKnowledgeDocument({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      documentId: "doc-1"
    });

    expect(result).toMatchObject({
      document: { id: "doc-1", status: "published" },
      version: { id: "version-2", status: "published" }
    });
    expect(mocks.client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("FROM knowledge_documents"),
      [TENANT_ID, "doc-1"]
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("status IN ('indexed', 'published')"),
      [TENANT_ID, "doc-1"]
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining("SET status = 'published'"),
      [TENANT_ID, "version-2"]
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(7, "COMMIT");
  });

  it("refuses to publish documents before an indexed version exists", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "doc-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      publishKnowledgeDocument({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        documentId: "doc-1"
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_READY" });

    expect(mocks.client.query).toHaveBeenNthCalledWith(4, "ROLLBACK");
    expect(mocks.client.release).toHaveBeenCalled();
  });

  it("archives a document and its versions inside the tenant", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "doc-1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "doc-1", status: "archived", title: "Returns SOP" }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await archiveKnowledgeDocument({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      documentId: "doc-1"
    });

    expect(result).toMatchObject({
      document: { id: "doc-1", status: "archived" }
    });
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("UPDATE knowledge_document_versions"),
      [TENANT_ID, "doc-1"]
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("SET status = 'archived'"),
      [TENANT_ID, "doc-1", USER_ID]
    );
  });
});
