import { createHash } from "crypto";
import { recordAuditLog } from "@/server/audit";
import {
  getKnowledgeIngestionRecoverySeconds,
  lockPendingKnowledgeIngestionJobs,
  markKnowledgeIngestionJobFailed,
  saveKnowledgeExtractionResult,
  type KnowledgeChunkInput,
  type KnowledgeIngestionJob
} from "@/server/ai/knowledge-base";
import { classifyKnowledgeTextSafety } from "@/server/ai/knowledge-safety";
import { logger } from "@/server/logger";
import { getObjectBuffer, putObject, deleteObject } from "@/server/storage/r2";

const TEXT_CONTENT_TYPES = new Set(["text/plain", "text/markdown"]);
const MAX_EXTRACTED_TEXT_CHARS = Number(process.env.KNOWLEDGE_EXTRACTED_TEXT_MAX_CHARS ?? 1_000_000);
const CHUNK_TARGET_CHARS = Number(process.env.KNOWLEDGE_CHUNK_TARGET_CHARS ?? 1400);
const CHUNK_OVERLAP_CHARS = Number(process.env.KNOWLEDGE_CHUNK_OVERLAP_CHARS ?? 180);
const MAX_CHUNKS_PER_VERSION = Number(process.env.KNOWLEDGE_MAX_CHUNKS_PER_VERSION ?? 500);

class UnsupportedKnowledgeExtractorError extends Error {
  constructor(contentType: string) {
    super(`Knowledge extractor is not enabled for ${contentType}.`);
    this.name = "UnsupportedKnowledgeExtractorError";
  }
}

function normalizeContentType(contentType: string | null | undefined) {
  return (contentType ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function normalizeText(buffer: Buffer) {
  const text = buffer
    .toString("utf8")
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

function chunkText(text: string): KnowledgeChunkInput[] {
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
          extraction: "plain_text",
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
  return error instanceof UnsupportedKnowledgeExtractorError;
}

export async function deliverPendingKnowledgeIngestionJobs({
  limit = 5,
  tenantId
}: {
  limit?: number;
  tenantId?: string | null;
} = {}) {
  const pending = await lockPendingKnowledgeIngestionJobs({
    limit,
    tenantId,
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

    try {
      const contentType = normalizeContentType(job.content_type);
      if (!TEXT_CONTENT_TYPES.has(contentType)) {
        throw new UnsupportedKnowledgeExtractorError(contentType);
      }

      const { buffer } = await getObjectBuffer(job.object_key);
      const extractedText = normalizeText(buffer);
      const chunks = chunkText(extractedText);
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
          chunks
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

export { chunkText, normalizeText, UnsupportedKnowledgeExtractorError };
