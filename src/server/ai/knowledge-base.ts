import { createHash, randomUUID } from "crypto";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { deleteObject, putObject } from "@/server/storage/r2";

const MAX_KNOWLEDGE_FILE_BYTES = Number(process.env.KNOWLEDGE_FILE_MAX_BYTES ?? 25 * 1024 * 1024);
const KNOWLEDGE_INGESTION_RECOVERY_SECONDS = Number(
  process.env.KNOWLEDGE_INGESTION_RECOVERY_SECONDS ?? 300
);
const MAX_KNOWLEDGE_INGESTION_ATTEMPTS = Number(process.env.KNOWLEDGE_INGESTION_MAX_ATTEMPTS ?? 5);

const ALLOWED_FILE_TYPES = [
  {
    extensions: [".pdf"],
    contentTypes: ["application/pdf"],
    normalizedContentType: "application/pdf"
  },
  {
    extensions: [".doc"],
    contentTypes: ["application/msword"],
    normalizedContentType: "application/msword"
  },
  {
    extensions: [".docx"],
    contentTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ],
    normalizedContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  },
  {
    extensions: [".md", ".markdown"],
    contentTypes: ["text/markdown", "text/x-markdown", "text/plain", "application/octet-stream"],
    normalizedContentType: "text/markdown"
  },
  {
    extensions: [".txt"],
    contentTypes: ["text/plain", "application/octet-stream"],
    normalizedContentType: "text/plain"
  }
] as const;

export type KnowledgeFolderVisibility = "ai_visible" | "admin_only";
export type KnowledgeDocumentKind =
  | "sop"
  | "policy"
  | "faq"
  | "product_manual"
  | "escalation_guide"
  | "compliance_note"
  | "playbook"
  | "other";

export class KnowledgeBaseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_FILE"
      | "FOLDER_NOT_FOUND"
      | "DOCUMENT_NOT_FOUND"
      | "DOCUMENT_NOT_READY"
      | "UPLOAD_FAILED"
      | "DATABASE_FAILED"
  ) {
    super(message);
    this.name = "KnowledgeBaseError";
  }
}

export type KnowledgeIngestionJob = {
  id: string;
  tenant_id: string;
  document_version_id: string;
  document_id: string;
  version_number: number;
  original_filename: string;
  content_type: string;
  object_key: string;
  attempt_count: number;
  metadata: Record<string, unknown> | null;
};

export type KnowledgeChunkInput = {
  chunkIndex: number;
  contentText: string;
  tokenEstimate: number;
  sourceLocator: string;
  contentHash: string;
  metadata?: Record<string, unknown>;
};

type KnowledgeIngestionSummaryRow = {
  queued: number | string | null;
  due_now: number | string | null;
  running: number | string | null;
  indexed: number | string | null;
  failed: number | string | null;
  poison: number | string | null;
  next_attempt_at: Date | string | null;
  last_indexed_at: Date | string | null;
  last_failed_at: Date | string | null;
};

type KnowledgeIngestionErrorRow = {
  last_error: string | null;
};

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value) || 0;
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function getExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

function sanitizeFileName(fileName: string) {
  const sanitized = fileName
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 180);
  return sanitized || "knowledge-document";
}

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function titleFromFileName(fileName: string) {
  const sanitized = sanitizeFileName(fileName);
  return sanitized.replace(/\.[a-z0-9]+$/i, "").trim() || sanitized;
}

function resolveAllowedFile(fileName: string, contentType: string | null | undefined, sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new KnowledgeBaseError("File is empty.", "INVALID_FILE");
  }
  if (sizeBytes > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new KnowledgeBaseError("File exceeds the configured size limit.", "INVALID_FILE");
  }

  const extension = getExtension(fileName);
  const normalizedContentType = (contentType ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  const allowed = ALLOWED_FILE_TYPES.find(
    (type) =>
      type.extensions.includes(extension as never) &&
      type.contentTypes.includes(normalizedContentType as never)
  );

  if (!allowed) {
    throw new KnowledgeBaseError("Unsupported file type.", "INVALID_FILE");
  }

  return {
    extension,
    contentType: allowed.normalizedContentType
  };
}

function buildObjectKey({
  tenantId,
  documentId,
  versionId,
  fileName
}: {
  tenantId: string;
  documentId: string;
  versionId: string;
  fileName: string;
}) {
  return `tenants/${tenantId}/ai-knowledge/${documentId}/versions/${versionId}/${sanitizeFileName(fileName)}`;
}

async function assertFolderInTenant(folderId: string | null | undefined, tenantId: string) {
  if (!folderId) return;

  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM knowledge_folders
     WHERE tenant_id = $1
       AND id = $2
       AND archived_at IS NULL
     LIMIT 1`,
    [tenantId, folderId]
  );

  if (!result.rows[0]) {
    throw new KnowledgeBaseError("Knowledge folder was not found in this tenant.", "FOLDER_NOT_FOUND");
  }
}

export async function listKnowledgeBase(tenantId: string) {
  const [foldersResult, documentsResult] = await Promise.all([
    db.query(
      `SELECT id, parent_folder_id, name, description, visibility, created_at, updated_at
       FROM knowledge_folders
       WHERE tenant_id = $1
         AND archived_at IS NULL
       ORDER BY parent_folder_id NULLS FIRST, name ASC`,
      [tenantId]
    ),
    db.query(
      `SELECT d.id, d.folder_id, d.title, d.source_type, d.document_kind, d.status,
              d.created_at, d.updated_at,
              v.id AS latest_version_id,
              v.version_number AS latest_version_number,
              v.status AS latest_version_status,
              v.original_filename,
              v.content_type,
              v.size_bytes,
              v.checksum_sha256,
              v.chunk_count,
              v.embedding_count,
              v.created_at AS latest_version_created_at
       FROM knowledge_documents d
       LEFT JOIN LATERAL (
         SELECT id, version_number, status, original_filename, content_type, size_bytes,
                checksum_sha256, chunk_count, embedding_count, created_at
         FROM knowledge_document_versions
         WHERE tenant_id = d.tenant_id
           AND document_id = d.id
           AND deleted_at IS NULL
         ORDER BY version_number DESC
         LIMIT 1
       ) v ON true
       WHERE d.tenant_id = $1
         AND d.deleted_at IS NULL
       ORDER BY d.updated_at DESC`,
      [tenantId]
    )
  ]);

  return {
    folders: foldersResult.rows,
    documents: documentsResult.rows
  };
}

export function getKnowledgeIngestionRecoverySeconds() {
  if (!Number.isFinite(KNOWLEDGE_INGESTION_RECOVERY_SECONDS) || KNOWLEDGE_INGESTION_RECOVERY_SECONDS <= 0) {
    return 300;
  }
  return Math.floor(KNOWLEDGE_INGESTION_RECOVERY_SECONDS);
}

export async function lockPendingKnowledgeIngestionJobs({
  limit = 5,
  processingRecoverySeconds = getKnowledgeIngestionRecoverySeconds(),
  tenantId,
  lockedBy = "knowledge-ingestion-worker"
}: {
  limit?: number;
  processingRecoverySeconds?: number;
  tenantId?: string | null;
  lockedBy?: string;
} = {}) {
  const normalizedLimit = Math.min(Math.max(limit, 1), 50);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<KnowledgeIngestionJob>(
      `WITH selected AS (
         SELECT id
         FROM knowledge_ingestion_jobs
         WHERE
           (
             (status = 'queued' AND next_attempt_at <= now())
             OR (
               status = 'running'
               AND updated_at <= now() - make_interval(secs => $2::int)
             )
           )
           AND ($3::uuid IS NULL OR tenant_id = $3::uuid)
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       ),
       updated_jobs AS (
         UPDATE knowledge_ingestion_jobs job
         SET status = 'running',
             last_error = NULL,
             locked_at = now(),
             locked_by = $4,
             updated_at = now()
         FROM selected
         WHERE job.id = selected.id
         RETURNING job.id, job.tenant_id, job.document_version_id, job.attempt_count
       ),
       updated_versions AS (
         UPDATE knowledge_document_versions version
         SET status = 'processing',
             updated_at = now()
         FROM updated_jobs job
         WHERE version.tenant_id = job.tenant_id
           AND version.id = job.document_version_id
         RETURNING version.id
       )
       SELECT job.id,
              job.tenant_id,
              job.document_version_id,
              version.document_id,
              version.version_number,
              version.original_filename,
              version.content_type,
              version.object_key,
              job.attempt_count,
              version.metadata
       FROM updated_jobs job
       JOIN knowledge_document_versions version
         ON version.tenant_id = job.tenant_id
        AND version.id = job.document_version_id
       ORDER BY version.created_at ASC`,
      [normalizedLimit, processingRecoverySeconds, tenantId ?? null, lockedBy.slice(0, 120)]
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function saveKnowledgeExtractionResult({
  tenantId,
  jobId,
  documentVersionId,
  attemptCount,
  extractedTextKey,
  chunks
}: {
  tenantId: string;
  jobId: string;
  documentVersionId: string;
  attemptCount: number;
  extractedTextKey: string;
  chunks: KnowledgeChunkInput[];
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM knowledge_chunks
       WHERE tenant_id = $1
         AND document_version_id = $2`,
      [tenantId, documentVersionId]
    );

    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO knowledge_chunks (
           tenant_id, document_version_id, chunk_index, content_text,
           token_estimate, source_locator, content_hash, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          tenantId,
          documentVersionId,
          chunk.chunkIndex,
          chunk.contentText,
          chunk.tokenEstimate,
          chunk.sourceLocator,
          chunk.contentHash,
          JSON.stringify(chunk.metadata ?? {})
        ]
      );
    }

    await client.query(
      `UPDATE knowledge_document_versions
       SET status = 'indexed',
           extracted_text_key = $3,
           chunk_count = $4,
           extraction_error = NULL,
           metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2`,
      [
        tenantId,
        documentVersionId,
        extractedTextKey,
        chunks.length,
        JSON.stringify({
          ingestion: {
            extractionStatus: "indexed",
            indexedAt: new Date().toISOString()
          }
        })
      ]
    );

    await client.query(
      `UPDATE knowledge_ingestion_jobs
       SET status = 'indexed',
           attempt_count = $3,
           last_error = NULL,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2`,
      [tenantId, jobId, attemptCount]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markKnowledgeIngestionJobFailed({
  tenantId,
  jobId,
  documentVersionId,
  attemptCount,
  errorMessage,
  poison = false
}: {
  tenantId: string;
  jobId: string;
  documentVersionId: string;
  attemptCount: number;
  errorMessage: string;
  poison?: boolean;
}) {
  const terminal = poison || attemptCount >= MAX_KNOWLEDGE_INGESTION_ATTEMPTS;
  const jobStatus = poison ? "poison" : terminal ? "failed" : "queued";
  const versionStatus = terminal ? "failed" : "uploaded";
  const nextAttempt = new Date(Date.now() + Math.min(attemptCount, 5) * 60_000);
  const detail = errorMessage.slice(0, 500);

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE knowledge_document_versions
       SET status = $3,
           extraction_error = $4,
           metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2`,
      [
        tenantId,
        documentVersionId,
        versionStatus,
        detail,
        JSON.stringify({
          ingestion: {
            extractionStatus: jobStatus,
            lastFailedAt: new Date().toISOString()
          }
        })
      ]
    );
    await client.query(
      `UPDATE knowledge_ingestion_jobs
       SET status = $3,
           attempt_count = $4,
           last_error = $5,
           next_attempt_at = $6,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2`,
      [tenantId, jobId, jobStatus, attemptCount, detail, terminal ? new Date("9999-12-31T00:00:00.000Z") : nextAttempt]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getKnowledgeIngestionMetrics(tenantId: string) {
  const [summaryResult, errorResult] = await Promise.all([
    db.query<KnowledgeIngestionSummaryRow>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
         COUNT(*) FILTER (WHERE status = 'queued' AND next_attempt_at <= now())::int AS due_now,
         COUNT(*) FILTER (WHERE status = 'running')::int AS running,
         COUNT(*) FILTER (
           WHERE status = 'indexed'
             AND updated_at >= now() - interval '24 hours'
         )::int AS indexed,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE status = 'poison')::int AS poison,
         MIN(next_attempt_at) FILTER (WHERE status = 'queued') AS next_attempt_at,
         MAX(updated_at) FILTER (WHERE status = 'indexed') AS last_indexed_at,
         MAX(updated_at) FILTER (WHERE status IN ('failed', 'poison')) AS last_failed_at
       FROM knowledge_ingestion_jobs
       WHERE tenant_id = $1`,
      [tenantId]
    ),
    db.query<KnowledgeIngestionErrorRow>(
      `SELECT last_error
       FROM knowledge_ingestion_jobs
       WHERE tenant_id = $1
         AND status IN ('failed', 'poison')
         AND last_error IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenantId]
    )
  ]);

  const summary = summaryResult.rows[0] ?? {
    queued: 0,
    due_now: 0,
    running: 0,
    indexed: 0,
    failed: 0,
    poison: 0,
    next_attempt_at: null,
    last_indexed_at: null,
    last_failed_at: null
  };

  return {
    queued: toNumber(summary.queued),
    dueNow: toNumber(summary.due_now),
    running: toNumber(summary.running),
    indexed24h: toNumber(summary.indexed),
    failed: toNumber(summary.failed),
    poison: toNumber(summary.poison),
    nextAttemptAt: toIso(summary.next_attempt_at),
    lastIndexedAt: toIso(summary.last_indexed_at),
    lastFailedAt: toIso(summary.last_failed_at),
    lastError: errorResult.rows[0]?.last_error ?? null
  };
}

export async function createKnowledgeFolder({
  tenantId,
  actorUserId,
  name,
  parentFolderId,
  description,
  visibility = "ai_visible"
}: {
  tenantId: string;
  actorUserId: string;
  name: string;
  parentFolderId?: string | null;
  description?: string | null;
  visibility?: KnowledgeFolderVisibility;
}) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new KnowledgeBaseError("Folder name is required.", "INVALID_FILE");
  }
  await assertFolderInTenant(parentFolderId, tenantId);

  const result = await db.query(
    `INSERT INTO knowledge_folders (
       tenant_id, parent_folder_id, name, description, visibility,
       created_by_user_id, updated_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING id, parent_folder_id, name, description, visibility, created_at, updated_at`,
    [
      tenantId,
      parentFolderId ?? null,
      normalizedName,
      trimOrNull(description),
      visibility,
      actorUserId
    ]
  );

  return result.rows[0];
}

export async function uploadKnowledgeDocument({
  tenantId,
  actorUserId,
  folderId,
  title,
  documentKind = "sop",
  fileName,
  contentType,
  buffer
}: {
  tenantId: string;
  actorUserId: string;
  folderId?: string | null;
  title?: string | null;
  documentKind?: KnowledgeDocumentKind;
  fileName: string;
  contentType?: string | null;
  buffer: Buffer;
}) {
  await assertFolderInTenant(folderId, tenantId);

  const safeFileName = sanitizeFileName(fileName);
  const allowed = resolveAllowedFile(safeFileName, contentType, buffer.byteLength);
  const documentId = randomUUID();
  const versionId = randomUUID();
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const objectKey = buildObjectKey({
    tenantId,
    documentId,
    versionId,
    fileName: safeFileName
  });

  try {
    await putObject({
      key: objectKey,
      body: buffer,
      contentType: allowed.contentType
    });
  } catch (error) {
    throw new KnowledgeBaseError("Failed to store knowledge document.", "UPLOAD_FAILED");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const documentResult = await client.query(
      `INSERT INTO knowledge_documents (
         id, tenant_id, folder_id, title, source_type, document_kind, status,
         created_by_user_id, updated_by_user_id
       )
       VALUES ($1, $2, $3, $4, 'direct_upload', $5, 'draft', $6, $6)
       RETURNING id, folder_id, title, source_type, document_kind, status, created_at, updated_at`,
      [
        documentId,
        tenantId,
        folderId ?? null,
        trimOrNull(title) ?? titleFromFileName(safeFileName),
        documentKind,
        actorUserId
      ]
    );

    const versionResult = await client.query(
      `INSERT INTO knowledge_document_versions (
         id, tenant_id, document_id, version_number, status, original_filename,
         content_type, size_bytes, checksum_sha256, object_key, uploaded_by_user_id,
         metadata
       )
       VALUES ($1, $2, $3, 1, 'uploaded', $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, document_id, version_number, status, original_filename, content_type,
                 size_bytes, checksum_sha256, object_key, created_at, updated_at`,
      [
        versionId,
        tenantId,
        documentId,
        safeFileName,
        allowed.contentType,
        buffer.byteLength,
        checksum,
        objectKey,
        actorUserId,
        {
          extension: allowed.extension,
          ingestion: {
            scanStatus: "pending",
            extractionStatus: "queued"
          }
        }
      ]
    );

    const jobResult = await client.query(
      `INSERT INTO knowledge_ingestion_jobs (
         tenant_id, document_version_id, job_type, status
       )
       VALUES ($1, $2, 'extract_and_index', 'queued')
       RETURNING id, status, next_attempt_at, created_at`,
      [tenantId, versionId]
    );

    await client.query("COMMIT");

    return {
      document: documentResult.rows[0],
      version: versionResult.rows[0],
      ingestionJob: jobResult.rows[0]
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logger.warn("Failed to roll back knowledge document upload transaction", {
        error: rollbackError,
        tenantId,
        documentId,
        versionId
      });
    }
    try {
      await deleteObject(objectKey);
    } catch (cleanupError) {
      logger.warn("Failed to delete uploaded knowledge object after database registration failure", {
        error: cleanupError,
        tenantId,
        documentId,
        versionId,
        objectKey
      });
    }
    throw new KnowledgeBaseError("Failed to register knowledge document.", "DATABASE_FAILED");
  } finally {
    client.release();
  }
}

export async function publishKnowledgeDocument({
  tenantId,
  actorUserId,
  documentId
}: {
  tenantId: string;
  actorUserId: string;
  documentId: string;
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const documentResult = await client.query<{ id: string }>(
      `SELECT id
       FROM knowledge_documents
       WHERE tenant_id = $1
         AND id = $2
         AND deleted_at IS NULL
       FOR UPDATE`,
      [tenantId, documentId]
    );
    if (!documentResult.rows[0]) {
      await client.query("ROLLBACK");
      throw new KnowledgeBaseError("Knowledge document was not found in this tenant.", "DOCUMENT_NOT_FOUND");
    }

    const versionResult = await client.query(
      `SELECT id, document_id, version_number, status, original_filename, content_type,
              size_bytes, checksum_sha256, extracted_text_key, chunk_count, embedding_count
       FROM knowledge_document_versions
       WHERE tenant_id = $1
         AND document_id = $2
         AND deleted_at IS NULL
         AND status IN ('indexed', 'published')
       ORDER BY version_number DESC
       LIMIT 1
       FOR UPDATE`,
      [tenantId, documentId]
    );
    const version = versionResult.rows[0];
    if (!version) {
      await client.query("ROLLBACK");
      throw new KnowledgeBaseError("Knowledge document has no indexed version to publish.", "DOCUMENT_NOT_READY");
    }

    await client.query(
      `UPDATE knowledge_document_versions
       SET status = 'archived',
           archived_at = COALESCE(archived_at, now()),
           updated_at = now()
       WHERE tenant_id = $1
         AND document_id = $2
         AND id <> $3
         AND status IN ('indexed', 'published')`,
      [tenantId, documentId, version.id]
    );

    const publishedVersionResult = await client.query(
      `UPDATE knowledge_document_versions
       SET status = 'published',
           published_at = COALESCE(published_at, now()),
           archived_at = NULL,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2
       RETURNING id, document_id, version_number, status, original_filename, content_type,
                 size_bytes, checksum_sha256, extracted_text_key, chunk_count, embedding_count,
                 published_at, updated_at`,
      [tenantId, version.id]
    );

    const publishedDocumentResult = await client.query(
      `UPDATE knowledge_documents
       SET status = 'published',
           updated_by_user_id = $3,
           archived_at = NULL,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2
       RETURNING id, folder_id, title, source_type, document_kind, status, created_at, updated_at`,
      [tenantId, documentId, actorUserId]
    );

    await client.query("COMMIT");
    return {
      document: publishedDocumentResult.rows[0],
      version: publishedVersionResult.rows[0]
    };
  } catch (error) {
    if (error instanceof KnowledgeBaseError) {
      throw error;
    }
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logger.warn("Failed to roll back knowledge document publish transaction", {
        error: rollbackError,
        tenantId,
        documentId
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveKnowledgeDocument({
  tenantId,
  actorUserId,
  documentId
}: {
  tenantId: string;
  actorUserId: string;
  documentId: string;
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const documentResult = await client.query<{ id: string }>(
      `SELECT id
       FROM knowledge_documents
       WHERE tenant_id = $1
         AND id = $2
         AND deleted_at IS NULL
       FOR UPDATE`,
      [tenantId, documentId]
    );
    if (!documentResult.rows[0]) {
      await client.query("ROLLBACK");
      throw new KnowledgeBaseError("Knowledge document was not found in this tenant.", "DOCUMENT_NOT_FOUND");
    }

    await client.query(
      `UPDATE knowledge_document_versions
       SET status = 'archived',
           archived_at = COALESCE(archived_at, now()),
           updated_at = now()
       WHERE tenant_id = $1
         AND document_id = $2
         AND deleted_at IS NULL
         AND status <> 'deleted'`,
      [tenantId, documentId]
    );

    const archivedDocumentResult = await client.query(
      `UPDATE knowledge_documents
       SET status = 'archived',
           updated_by_user_id = $3,
           archived_at = COALESCE(archived_at, now()),
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2
       RETURNING id, folder_id, title, source_type, document_kind, status, created_at, updated_at, archived_at`,
      [tenantId, documentId, actorUserId]
    );

    await client.query("COMMIT");
    return {
      document: archivedDocumentResult.rows[0]
    };
  } catch (error) {
    if (error instanceof KnowledgeBaseError) {
      throw error;
    }
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logger.warn("Failed to roll back knowledge document archive transaction", {
        error: rollbackError,
        tenantId,
        documentId
      });
    }
    throw error;
  } finally {
    client.release();
  }
}
