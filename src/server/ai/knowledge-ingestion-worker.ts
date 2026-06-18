import { createHash } from "crypto";
import { recordAuditLog } from "@/server/audit";
import {
  extractKnowledgeDocumentText,
  extractMalwareScanDetails,
  getKnowledgeIngestionRecoverySeconds,
  KnowledgeIngestionSafetyError,
  lockPendingKnowledgeIngestionJobs,
  markKnowledgeIngestionJobFailed,
  recordKnowledgeQuarantineEvent,
  saveKnowledgeExtractionResult,
  scanKnowledgeUploadForMalware,
  type KnowledgeChunkInput,
  type KnowledgeIngestionJob,
  type KnowledgeMalwareScanResult
} from "@/server/ai/knowledge-base";
import {
  classifyKnowledgeTextSafety,
  isHighRiskKnowledgeSafety
} from "@/server/ai/knowledge-safety";
import { logger } from "@/server/logger";
import { getObjectBuffer, putObject, deleteObject } from "@/server/storage/r2";

const TEXT_CONTENT_TYPES = new Set(["text/plain", "text/markdown"]);
const MAX_EXTRACTED_TEXT_CHARS = Number(process.env.KNOWLEDGE_EXTRACTED_TEXT_MAX_CHARS ?? 1_000_000);
const CHUNK_TARGET_CHARS = Number(process.env.KNOWLEDGE_CHUNK_TARGET_CHARS ?? 1400);
const CHUNK_OVERLAP_CHARS = Number(process.env.KNOWLEDGE_CHUNK_OVERLAP_CHARS ?? 180);
const MAX_CHUNKS_PER_VERSION = Number(process.env.KNOWLEDGE_MAX_CHUNKS_PER_VERSION ?? 500);

function normalizeContentType(contentType: string | null | undefined) {
  return (contentType ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function normalizeText(value: Buffer | string) {
  const text = (typeof value === "string" ? value : value.toString("utf8"))
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  if (!text) {
    throw new Error("Knowledge document extracted no usable text.");
  }
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new Error("Knowledge document exceeds the extracted text limit.");
  }
  return text;
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function buildExtractedTextKey(job: KnowledgeIngestionJob) {
  return `tenants/${job.tenant_id}/ai-knowledge/${job.document_id}/versions/${job.document_version_id}/extracted.txt`;
}

function chunkText(text: string, extractionMetadata: Record<string, unknown>): KnowledgeChunkInput[] {
  const targetChars = Math.min(Math.max(CHUNK_TARGET_CHARS, 500), 4000);
  const overlapChars = Math.min(Math.max(CHUNK_OVERLAP_CHARS, 0), Math.floor(targetChars / 3));
  const chunks: KnowledgeChunkInput[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + targetChars, text.length);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      const sentenceBreak = text.lastIndexOf(". ", end);
      const softBreak = Math.max(paragraphBreak, sentenceBreak);
      if (softBreak > start + Math.floor(targetChars * 0.55)) {
        end = softBreak + (softBreak === sentenceBreak ? 1 : 0);
      }
    }

    const contentText = text.slice(start, end).trim();
    if (contentText) {
      chunks.push({
        chunkIndex: chunks.length,
        contentText,
        tokenEstimate: estimateTokens(contentText),
        sourceLocator: `chars:${start}-${end}`,
        contentHash: hashText(contentText),
        metadata: {
          extraction: extractionMetadata,
          safety: classifyKnowledgeTextSafety(contentText),
          startChar: start,
          endChar: end
        }
      });
    }

    if (end >= text.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }

  if (!chunks.length) {
    throw new Error("Knowledge document produced no chunks.");
  }
  if (chunks.length > MAX_CHUNKS_PER_VERSION) {
    throw new Error("Knowledge document produced too many chunks.");
  }
  return chunks;
}

function shouldPoison(error: unknown) {
  if (error instanceof KnowledgeIngestionSafetyError) {
    return error.poison;
  }
  return false;
}

function reasonCodeForError(error: unknown) {
  if (error instanceof KnowledgeIngestionSafetyError) {
    return error.code;
  }
  return "knowledge_ingestion_failed";
}

function requireTenantId(value: string | null | undefined) {
  const tenantId = value?.trim();
  if (!tenantId) {
    throw new Error("Deliver knowledge ingestion jobs requires tenantId");
  }
  return tenantId;
}

export async function deliverPendingKnowledgeIngestionJobs({
  limit = 5,
  tenantId
}: {
  limit?: number;
  tenantId?: string | null;
} = {}) {
  const scopedTenantId = requireTenantId(tenantId);
  const pending = await lockPendingKnowledgeIngestionJobs({
    limit,
    tenantId: scopedTenantId,
    processingRecoverySeconds: getKnowledgeIngestionRecoverySeconds()
  });

  if (!pending.length) {
    return { indexed: 0, failed: 0, poison: 0, total: 0 };
  }

  let indexed = 0;
  let failed = 0;
  let poison = 0;

  for (const job of pending) {
    const attemptCount = job.attempt_count + 1;
    let extractedTextKey: string | null = null;
    let originalBuffer: Buffer | null = null;
    let checksumSha256: string | null = null;
    let malwareScan: KnowledgeMalwareScanResult | null = null;

    try {
      const contentType = normalizeContentType(job.content_type);
      const { buffer } = await getObjectBuffer(job.object_key);
      originalBuffer = buffer;
      checksumSha256 = createHash("sha256").update(buffer).digest("hex");
      malwareScan = await scanKnowledgeUploadForMalware({
        fileName: job.original_filename,
        contentType,
        checksumSha256,
        buffer
      });

      let extractedText: string;
      let extractionMetadata: Record<string, unknown>;
      if (TEXT_CONTENT_TYPES.has(contentType)) {
        extractedText = normalizeText(buffer);
        extractionMetadata = {
          status: "completed",
          extractor: "inline_text",
          contentKind: "text",
          extractedAt: new Date().toISOString()
        };
      } else {
        const extraction = await extractKnowledgeDocumentText({
          fileName: job.original_filename,
          contentType,
          checksumSha256,
          buffer
        });
        extractedText = normalizeText(extraction.text);
        extractionMetadata = extraction.metadata;
      }

      const documentSafety = classifyKnowledgeTextSafety(extractedText);
      if (isHighRiskKnowledgeSafety(documentSafety)) {
        throw new KnowledgeIngestionSafetyError(
          "prompt_injection_detected",
          "Knowledge document contains unsafe AI-control language and was not indexed.",
          true,
          { safety: documentSafety }
        );
      }

      const chunks = chunkText(extractedText, extractionMetadata);
      extractedTextKey = buildExtractedTextKey(job);

      await putObject({
        key: extractedTextKey,
        body: extractedText,
        contentType: "text/plain; charset=utf-8"
      });

      try {
        await saveKnowledgeExtractionResult({
          tenantId: job.tenant_id,
          jobId: job.id,
          documentVersionId: job.document_version_id,
          attemptCount,
          extractedTextKey,
          chunks,
          metadata: {
            malwareScan,
            extraction: extractionMetadata,
            safety: documentSafety
          }
        });
      } catch (error) {
        try {
          await deleteObject(extractedTextKey);
        } catch (cleanupError) {
          logger.warn("Failed to delete extracted knowledge artifact after ingestion save failure", {
            error: cleanupError,
            tenantId: job.tenant_id,
            jobId: job.id,
            documentVersionId: job.document_version_id,
            objectKey: extractedTextKey
          });
        }
        throw error;
      }

      indexed += 1;
    } catch (error) {
      const poisonFailure = shouldPoison(error);
      if (poisonFailure) {
        poison += 1;
        try {
          await recordKnowledgeQuarantineEvent({
            tenantId: job.tenant_id,
            documentId: job.document_id,
            documentVersionId: job.document_version_id,
            ingestionJobId: job.id,
            fileName: job.original_filename,
            contentType: job.content_type,
            checksumSha256: checksumSha256 ?? hashText(`${job.object_key}:${job.id}`),
            sizeBytes: originalBuffer?.byteLength ?? 0,
            reasonCode: reasonCodeForError(error),
            detail: error instanceof Error ? error.message : "Knowledge ingestion rejected",
            malwareScan: extractMalwareScanDetails(error) ?? malwareScan,
            buffer: originalBuffer,
            metadata: error instanceof KnowledgeIngestionSafetyError ? error.details ?? {} : {}
          });
        } catch (quarantineError) {
          logger.warn("Failed to record knowledge quarantine event", {
            error: quarantineError,
            tenantId: job.tenant_id,
            jobId: job.id,
            documentVersionId: job.document_version_id
          });
        }
      } else {
        failed += 1;
      }
      const detail = error instanceof Error ? error.message : "Knowledge ingestion failed";
      await markKnowledgeIngestionJobFailed({
        tenantId: job.tenant_id,
        jobId: job.id,
        documentVersionId: job.document_version_id,
        attemptCount,
        errorMessage: detail,
        poison: poisonFailure
      });
      try {
        await recordAuditLog({
          tenantId: job.tenant_id,
          action: "knowledge_ingestion_job_failed",
          entityType: "knowledge_ingestion_jobs",
          entityId: job.id,
          data: {
            documentVersionId: job.document_version_id,
            documentId: job.document_id,
            contentType: job.content_type,
            poison: poisonFailure,
            reasonCode: reasonCodeForError(error),
            detail
          }
        });
      } catch (auditError) {
        logger.warn("Failed to record knowledge ingestion job failure audit event", {
          error: auditError,
          tenantId: job.tenant_id,
          jobId: job.id,
          documentVersionId: job.document_version_id
        });
      }
    }
  }

  return {
    indexed,
    failed,
    poison,
    total: pending.length
  };
}

export { chunkText, normalizeText };
