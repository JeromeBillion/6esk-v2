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
  getKnowledgeIngestionReadiness,
  KnowledgeBaseError,
  listKnowledgeBase,
  lockPendingKnowledgeIngestionJobs,
  publishKnowledgeDocument,
  recordKnowledgeQuarantineEvent,
  scanKnowledgeUploadForMalware,
  uploadKnowledgeDocument
} from "@/server/ai/knowledge-base";

describe("knowledge base service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

  it("rejects ingestion job locking without tenant scope", async () => {
    await expect(lockPendingKnowledgeIngestionJobs({ limit: 5, tenantId: "" })).rejects.toThrow(
      "Lock pending knowledge ingestion jobs requires tenantId"
    );

    expect(mocks.db.connect).not.toHaveBeenCalled();
  });

  it("locks ingestion jobs only inside the requested tenant", async () => {
    mocks.client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(undefined);

    const result = await lockPendingKnowledgeIngestionJobs({
      limit: 7,
      processingRecoverySeconds: 180,
      tenantId: TENANT_ID,
      lockedBy: "worker-test"
    });

    expect(result).toEqual([]);
    expect(mocks.client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND tenant_id = $3::uuid"),
      [7, 180, TENANT_ID, "worker-test"]
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(3, "COMMIT");
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

  it("rejects declared PDFs whose bytes do not match the PDF signature", async () => {
    await expect(
      uploadKnowledgeDocument({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        fileName: "policy.pdf",
        contentType: "application/pdf",
        buffer: Buffer.from("not really a pdf")
      })
    ).rejects.toMatchObject({
      code: "INVALID_FILE",
      message: "File content does not match the declared file type."
    });

    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.db.connect).not.toHaveBeenCalled();
  });

  it("rejects binary files disguised as Markdown before object storage", async () => {
    await expect(
      uploadKnowledgeDocument({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        fileName: "sop.md",
        contentType: "text/markdown",
        buffer: Buffer.from([0x23, 0x20, 0x53, 0x4f, 0x50, 0x00, 0x01])
      })
    ).rejects.toMatchObject({ code: "INVALID_FILE" });

    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.db.connect).not.toHaveBeenCalled();
  });

  it("accepts PDFs only after server-side byte sniffing passes", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "doc-1", title: "Policy", folder_id: null }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: "version-1",
          document_id: "doc-1",
          original_filename: "policy.pdf",
          content_type: "application/pdf",
          size_bytes: 16
        }]
      })
      .mockResolvedValueOnce({ rows: [{ id: "job-1", status: "queued" }] })
      .mockResolvedValueOnce({ rows: [] });

    await uploadKnowledgeDocument({
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      fileName: "policy.pdf",
      contentType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n%test")
    });

    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "application/pdf"
      })
    );
  });

  it("fails closed when Knowledge Base malware scanning is required but unconfigured", async () => {
    vi.stubEnv("AI_KNOWLEDGE_REQUIRE_MALWARE_SCAN", "true");
    vi.stubEnv("AI_KNOWLEDGE_MALWARE_SCAN_URL", "");

    await expect(
      scanKnowledgeUploadForMalware({
        fileName: "returns.md",
        contentType: "text/markdown",
        checksumSha256: "a".repeat(64),
        buffer: Buffer.from("# Returns")
      })
    ).rejects.toMatchObject({
      code: "malware_scanner_unconfigured",
      poison: true
    });
  });

  it("accepts clean Knowledge Base malware scanner results", async () => {
    vi.stubEnv("AI_KNOWLEDGE_REQUIRE_MALWARE_SCAN", "true");
    vi.stubEnv("AI_KNOWLEDGE_MALWARE_SCAN_URL", "https://scanner.6esk.example/scan");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "clean", scanner: "clamav" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await scanKnowledgeUploadForMalware({
      fileName: "returns.md",
      contentType: "text/markdown",
      checksumSha256: "b".repeat(64),
      buffer: Buffer.from("# Returns")
    });

    expect(result).toMatchObject({ status: "clean", scanner: "clamav" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://scanner.6esk.example/scan",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-knowledge-checksum-sha256": "b".repeat(64)
        })
      })
    );
  });

  it("rejects infected Knowledge Base malware scanner results", async () => {
    vi.stubEnv("AI_KNOWLEDGE_REQUIRE_MALWARE_SCAN", "true");
    vi.stubEnv("AI_KNOWLEDGE_MALWARE_SCAN_URL", "https://scanner.6esk.example/scan");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ status: "infected", scanner: "clamav", signature: "Eicar-Test" }),
          { status: 200 }
        )
      )
    );

    await expect(
      scanKnowledgeUploadForMalware({
        fileName: "returns.md",
        contentType: "text/markdown",
        checksumSha256: "c".repeat(64),
        buffer: Buffer.from("# Returns")
      })
    ).rejects.toMatchObject({
      code: "malware_detected",
      poison: true,
      details: {
        malwareScan: expect.objectContaining({
          status: "infected",
          signature: "Eicar-Test"
        })
      }
    });
  });

  it("reports Knowledge Base ingestion readiness blockers", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_KNOWLEDGE_REQUIRE_MALWARE_SCAN", "true");
    vi.stubEnv("AI_KNOWLEDGE_MALWARE_SCAN_URL", "");
    vi.stubEnv("AI_KNOWLEDGE_DOCUMENT_EXTRACTOR_URL", "");
    vi.stubEnv("AI_KNOWLEDGE_QUARANTINE_REQUIRE_BLOBS", "true");
    vi.stubEnv("R2_ENDPOINT", "");
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    vi.stubEnv("R2_BUCKET", "");

    const readiness = getKnowledgeIngestionReadiness();

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual([
      "malware_scanner_unconfigured",
      "document_extractor_unconfigured",
      "quarantine_storage_unconfigured"
    ]);
    expect(readiness.quarantineStorage.missing).toEqual([
      "R2_ENDPOINT",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET"
    ]);
  });

  it("records rejected uploads in tenant-scoped quarantine storage when enabled", async () => {
    vi.stubEnv("AI_KNOWLEDGE_QUARANTINE_STORE_BLOBS", "true");
    vi.stubEnv("R2_ENDPOINT", "https://r2.example.test");
    vi.stubEnv("R2_ACCESS_KEY_ID", "access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("R2_BUCKET", "knowledge-quarantine");
    mocks.db.query.mockResolvedValueOnce({
      rows: [{
        id: "quarantine-1",
        tenant_id: TENANT_ID,
        original_filename: "sop.pdf"
      }]
    });

    await recordKnowledgeQuarantineEvent({
      tenantId: TENANT_ID,
      documentId: "doc-1",
      documentVersionId: "version-1",
      ingestionJobId: "job-1",
      fileName: "sop.pdf",
      contentType: "application/pdf",
      checksumSha256: "d".repeat(64),
      sizeBytes: 8,
      reasonCode: "knowledge_extractor_unconfigured",
      detail: "PDF and Word knowledge uploads require a configured document extractor service.",
      malwareScan: {
        status: "skipped",
        scanner: "disabled",
        scannedAt: "2026-06-01T00:00:00.000Z"
      },
      buffer: Buffer.from("%PDF-1.7")
    });

    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(
          /^ai-knowledge\/quarantine\/tenants\/00000000-0000-0000-0000-000000000001\/\d{4}-\d{2}-\d{2}\/d{16}-[0-9a-f-]{36}-sop\.pdf$/
        ),
        body: Buffer.from("%PDF-1.7"),
        contentType: "application/pdf"
      })
    );
    const params = mocks.db.query.mock.calls[0][1] as unknown[];
    expect(mocks.db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO knowledge_quarantine_events"),
      expect.any(Array)
    );
    expect(params[0]).toBe(TENANT_ID);
    expect(params[8]).toBe("knowledge_extractor_unconfigured");
    expect(params[13]).toBe("r2");
    expect(params[14]).toBe("knowledge-quarantine");
    expect(params[15]).toEqual(expect.stringContaining(`/tenants/${TENANT_ID}/`));
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
