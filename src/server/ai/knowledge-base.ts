import { createHash, randomUUID } from "crypto";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { deleteObject, putObject } from "@/server/storage/r2";

const MAX_KNOWLEDGE_FILE_BYTES = Number(process.env.KNOWLEDGE_FILE_MAX_BYTES ?? 25 * 1024 * 1024);
const KNOWLEDGE_INGESTION_RECOVERY_SECONDS = Number(
  process.env.KNOWLEDGE_INGESTION_RECOVERY_SECONDS ?? 300
);
const MAX_KNOWLEDGE_INGESTION_ATTEMPTS = Number(process.env.KNOWLEDGE_INGESTION_MAX_ATTEMPTS ?? 5);
const DEFAULT_MALWARE_SCAN_TIMEOUT_MS = 5_000;
const DEFAULT_DOCUMENT_EXTRACTOR_TIMEOUT_MS = 15_000;
const DEFAULT_QUARANTINE_PREFIX = "ai-knowledge/quarantine";

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

const EXTRACTABLE_DOCUMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

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

export class KnowledgeIngestionSafetyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly poison = true,
    public readonly details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "KnowledgeIngestionSafetyError";
  }
}

export type KnowledgeMalwareScanResult = {
  status: "clean" | "infected" | "unavailable" | "skipped";
  scanner: string;
  scannedAt: string;
  signature?: string | null;
  detail?: string | null;
};

export type KnowledgeExtractionResult = {
  text: string;
  metadata: Record<string, unknown>;
};

export type KnowledgeQuarantineEvent = {
  id: string;
  tenant_id: string;
  document_id: string | null;
  document_version_id: string | null;
  ingestion_job_id: string | null;
  original_filename: string;
  content_type: string;
  checksum_sha256: string;
  size_bytes: string | number;
  reason_code: string;
  scanner_status: string;
  scanner: string | null;
  scanner_signature: string | null;
  detail: string | null;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  stored_at: Date | string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
};

export type KnowledgeIngestionReadiness = {
  checkedAt: string;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  scanner: {
    status: "configured" | "required_unconfigured" | "optional_disabled";
    required: boolean;
    urlConfigured: boolean;
    timeoutMs: number;
  };
  extractor: {
    status: "configured" | "required_unconfigured";
    urlConfigured: boolean;
    timeoutMs: number;
    supportedContentTypes: string[];
  };
  quarantineStorage: {
    status: "configured" | "required_unconfigured" | "optional_disabled" | "enabled_unconfigured";
    enabled: boolean;
    required: boolean;
    bucketConfigured: boolean;
    missing: string[];
    prefix: string;
  };
};

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

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeContentType(value: string | null | undefined) {
  return (value ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function hasMagicPrefix(buffer: Buffer, signature: readonly number[]) {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

function bufferIncludesAscii(buffer: Buffer, value: string) {
  return buffer.includes(Buffer.from(value, "ascii"));
}

function looksLikeUtf8Text(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
  if (sample.includes(0)) return false;

  const decoded = sample.toString("utf8");
  if (!decoded || decoded.includes("\uFFFD")) return false;

  let disallowedControls = 0;
  for (let index = 0; index < decoded.length; index += 1) {
    const code = decoded.charCodeAt(index);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      disallowedControls += 1;
    }
  }
  return disallowedControls === 0;
}

function contentMatchesAllowedType(
  normalizedContentType: string,
  extension: string,
  buffer: Buffer
) {
  if (normalizedContentType === "application/pdf") {
    return hasMagicPrefix(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }
  if (normalizedContentType === "application/msword") {
    return hasMagicPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if (
    normalizedContentType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return (
      hasMagicPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) &&
      bufferIncludesAscii(buffer, "[Content_Types].xml") &&
      bufferIncludesAscii(buffer, "word/")
    );
  }
  if (
    normalizedContentType === "text/plain" ||
    normalizedContentType === "text/markdown" ||
    extension === ".txt" ||
    extension === ".md" ||
    extension === ".markdown"
  ) {
    return looksLikeUtf8Text(buffer);
  }
  return false;
}

function requiresKnowledgeMalwareScan() {
  const configured = process.env.AI_KNOWLEDGE_REQUIRE_MALWARE_SCAN;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}

function getKnowledgeMalwareScannerUrl() {
  return process.env.AI_KNOWLEDGE_MALWARE_SCAN_URL?.trim() || null;
}

function getKnowledgeDocumentExtractorUrl() {
  return process.env.AI_KNOWLEDGE_DOCUMENT_EXTRACTOR_URL?.trim() || null;
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]/g, " ").slice(0, 500);
}

function sanitizeObjectKeySegment(value: string | null | undefined, fallback: string, maxLength = 160) {
  const cleaned = (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._=-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (cleaned || fallback).slice(0, maxLength);
}

function normalizeQuarantineObjectPrefix() {
  const rawPrefix = process.env.AI_KNOWLEDGE_QUARANTINE_PREFIX?.trim() || DEFAULT_QUARANTINE_PREFIX;
  const prefix = rawPrefix
    .split("/")
    .map((segment) => sanitizeObjectKeySegment(segment, "", 96))
    .filter(Boolean)
    .join("/");
  return prefix || DEFAULT_QUARANTINE_PREFIX;
}

function getQuarantineStorageConfig() {
  const required = process.env.AI_KNOWLEDGE_QUARANTINE_REQUIRE_BLOBS === "true";
  const enabled = required || process.env.AI_KNOWLEDGE_QUARANTINE_STORE_BLOBS === "true";
  const bucket = process.env.R2_BUCKET?.trim() || null;
  const missing: string[] = [];
  if (!process.env.R2_ENDPOINT?.trim()) missing.push("R2_ENDPOINT");
  if (!process.env.R2_ACCESS_KEY_ID?.trim()) missing.push("R2_ACCESS_KEY_ID");
  if (!process.env.R2_SECRET_ACCESS_KEY?.trim()) missing.push("R2_SECRET_ACCESS_KEY");
  if (!bucket) missing.push("R2_BUCKET");
  return {
    enabled,
    required,
    bucket,
    missing,
    prefix: normalizeQuarantineObjectPrefix()
  };
}

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function titleFromFileName(fileName: string) {
  const sanitized = sanitizeFileName(fileName);
  return sanitized.replace(/\.[a-z0-9]+$/i, "").trim() || sanitized;
}

function resolveAllowedFile(
  fileName: string,
  contentType: string | null | undefined,
  buffer: Buffer
) {
  const sizeBytes = buffer.byteLength;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new KnowledgeBaseError("File is empty.", "INVALID_FILE");
  }
  if (sizeBytes > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new KnowledgeBaseError("File exceeds the configured size limit.", "INVALID_FILE");
  }

  const extension = getExtension(fileName);
  const normalizedContentType = normalizeContentType(contentType);
  const allowed = ALLOWED_FILE_TYPES.find(
    (type) =>
      type.extensions.includes(extension as never) &&
      type.contentTypes.includes(normalizedContentType as never)
  );

  if (!allowed) {
    throw new KnowledgeBaseError("Unsupported file type.", "INVALID_FILE");
  }
  if (!contentMatchesAllowedType(allowed.normalizedContentType, extension, buffer)) {
    throw new KnowledgeBaseError("File content does not match the declared file type.", "INVALID_FILE");
  }

  return {
    extension,
    contentType: allowed.normalizedContentType
  };
}

export function getKnowledgeIngestionReadiness(): KnowledgeIngestionReadiness {
  const scannerRequired = requiresKnowledgeMalwareScan();
  const scannerUrlConfigured = Boolean(getKnowledgeMalwareScannerUrl());
  const scannerStatus = scannerUrlConfigured
    ? "configured"
    : scannerRequired
      ? "required_unconfigured"
      : "optional_disabled";
  const extractorUrlConfigured = Boolean(getKnowledgeDocumentExtractorUrl());
  const extractorStatus = extractorUrlConfigured ? "configured" : "required_unconfigured";
  const quarantineConfig = getQuarantineStorageConfig();
  const quarantineStatus = quarantineConfig.enabled
    ? quarantineConfig.missing.length === 0
      ? "configured"
      : quarantineConfig.required
        ? "required_unconfigured"
        : "enabled_unconfigured"
    : "optional_disabled";
  const blockers = [
    scannerStatus === "required_unconfigured" ? "malware_scanner_unconfigured" : null,
    extractorStatus === "required_unconfigured" ? "document_extractor_unconfigured" : null,
    quarantineStatus === "required_unconfigured" ? "quarantine_storage_unconfigured" : null
  ].filter((value): value is string => Boolean(value));
  const warnings = [
    scannerStatus === "optional_disabled" ? "malware_scanner_optional_disabled" : null,
    quarantineStatus === "optional_disabled" ? "quarantine_storage_optional_disabled" : null,
    quarantineStatus === "enabled_unconfigured" ? "quarantine_storage_enabled_unconfigured" : null
  ].filter((value): value is string => Boolean(value));

  return {
    checkedAt: new Date().toISOString(),
    ready: blockers.length === 0,
    blockers,
    warnings,
    scanner: {
      status: scannerStatus,
      required: scannerRequired,
      urlConfigured: scannerUrlConfigured,
      timeoutMs: readPositiveIntegerEnv("AI_KNOWLEDGE_MALWARE_SCAN_TIMEOUT_MS", DEFAULT_MALWARE_SCAN_TIMEOUT_MS)
    },
    extractor: {
      status: extractorStatus,
      urlConfigured: extractorUrlConfigured,
      timeoutMs: readPositiveIntegerEnv(
        "AI_KNOWLEDGE_DOCUMENT_EXTRACTOR_TIMEOUT_MS",
        DEFAULT_DOCUMENT_EXTRACTOR_TIMEOUT_MS
      ),
      supportedContentTypes: Array.from(EXTRACTABLE_DOCUMENT_CONTENT_TYPES).sort()
    },
    quarantineStorage: {
      status: quarantineStatus,
      enabled: quarantineConfig.enabled,
      required: quarantineConfig.required,
      bucketConfigured: Boolean(quarantineConfig.bucket),
      missing: quarantineConfig.missing,
      prefix: quarantineConfig.prefix
    }
  };
}

export async function scanKnowledgeUploadForMalware(input: {
  fileName: string;
  contentType: string;
  checksumSha256: string;
  buffer: Buffer;
}): Promise<KnowledgeMalwareScanResult> {
  const scannerUrl = getKnowledgeMalwareScannerUrl();
  const scannedAt = new Date().toISOString();
  if (!scannerUrl) {
    if (requiresKnowledgeMalwareScan()) {
      throw new KnowledgeIngestionSafetyError(
        "malware_scanner_unconfigured",
        "Knowledge uploads require a configured malware scanner in this environment.",
        true,
        {
          malwareScan: {
            status: "unavailable",
            scanner: "unconfigured",
            scannedAt
          }
        }
      );
    }
    return {
      status: "skipped",
      scanner: "disabled",
      scannedAt,
      detail: "Malware scanning is disabled by policy."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    readPositiveIntegerEnv("AI_KNOWLEDGE_MALWARE_SCAN_TIMEOUT_MS", DEFAULT_MALWARE_SCAN_TIMEOUT_MS)
  );
  try {
    const response = await fetch(scannerUrl, {
      method: "POST",
      headers: {
        "content-type": input.contentType || "application/octet-stream",
        "x-knowledge-filename": sanitizeHeaderValue(input.fileName),
        "x-knowledge-checksum-sha256": sanitizeHeaderValue(input.checksumSha256)
      },
      body: toArrayBuffer(input.buffer),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new KnowledgeIngestionSafetyError(
        "malware_scan_unavailable",
        `Knowledge malware scanner returned HTTP ${response.status}.`,
        false,
        {
          malwareScan: {
            status: "unavailable",
            scanner: scannerUrl,
            scannedAt,
            detail: `HTTP ${response.status}`
          }
        }
      );
    }

    const payload = await response.json().catch(() => null) as {
      status?: string;
      scanner?: string;
      signature?: string | null;
      detail?: string | null;
    } | null;
    const status = payload?.status === "clean"
      ? "clean"
      : payload?.status === "infected"
        ? "infected"
        : "unavailable";
    const scanResult: KnowledgeMalwareScanResult = {
      status,
      scanner: payload?.scanner?.trim() || scannerUrl,
      scannedAt,
      signature: payload?.signature ?? null,
      detail: payload?.detail ?? null
    };
    if (scanResult.status !== "clean") {
      throw new KnowledgeIngestionSafetyError(
        scanResult.status === "infected" ? "malware_detected" : "malware_scan_unavailable",
        scanResult.status === "infected"
          ? "Knowledge upload was rejected by the malware scanner."
          : "Knowledge malware scanner returned an indeterminate result.",
        scanResult.status === "infected",
        { malwareScan: scanResult }
      );
    }
    return scanResult;
  } catch (error) {
    if (error instanceof KnowledgeIngestionSafetyError) {
      throw error;
    }
    throw new KnowledgeIngestionSafetyError(
      "malware_scan_unavailable",
      "Knowledge malware scanner could not be reached.",
      false,
      {
        malwareScan: {
          status: "unavailable",
          scanner: scannerUrl,
          scannedAt,
          detail: error instanceof Error ? error.message : "Unknown scanner error"
        }
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractKnowledgeDocumentText(input: {
  fileName: string;
  contentType: string;
  checksumSha256: string;
  buffer: Buffer;
}): Promise<KnowledgeExtractionResult> {
  const normalizedContentType = normalizeContentType(input.contentType);
  const extractedAt = new Date().toISOString();
  if (!EXTRACTABLE_DOCUMENT_CONTENT_TYPES.has(normalizedContentType)) {
    throw new KnowledgeIngestionSafetyError(
      "knowledge_extractor_unsupported",
      `Knowledge extractor is not enabled for ${normalizedContentType}.`,
      true,
      {
        extraction: {
          status: "unsupported",
          contentType: normalizedContentType,
          extractedAt
        }
      }
    );
  }

  const extractorUrl = getKnowledgeDocumentExtractorUrl();
  if (!extractorUrl) {
    throw new KnowledgeIngestionSafetyError(
      "knowledge_extractor_unconfigured",
      "PDF and Word knowledge uploads require a configured document extractor service.",
      true,
      {
        extraction: {
          status: "unavailable",
          extractor: "unconfigured",
          extractedAt
        }
      }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    readPositiveIntegerEnv("AI_KNOWLEDGE_DOCUMENT_EXTRACTOR_TIMEOUT_MS", DEFAULT_DOCUMENT_EXTRACTOR_TIMEOUT_MS)
  );
  try {
    const response = await fetch(extractorUrl, {
      method: "POST",
      headers: {
        "content-type": normalizedContentType || "application/octet-stream",
        "x-knowledge-filename": sanitizeHeaderValue(input.fileName),
        "x-knowledge-checksum-sha256": sanitizeHeaderValue(input.checksumSha256)
      },
      body: toArrayBuffer(input.buffer),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new KnowledgeIngestionSafetyError(
        "knowledge_extractor_unavailable",
        `Knowledge document extractor returned HTTP ${response.status}.`,
        response.status < 500,
        {
          extraction: {
            status: "unavailable",
            extractor: extractorUrl,
            extractedAt,
            detail: `HTTP ${response.status}`
          }
        }
      );
    }

    const payload = await response.json().catch(() => null) as {
      text?: string | null;
      title?: string | null;
      extractor?: string | null;
      warnings?: unknown;
      metadata?: unknown;
    } | null;
    const text = typeof payload?.text === "string"
      ? payload.text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim()
      : "";
    const extractor = payload?.extractor?.trim() || extractorUrl;
    const warnings = Array.isArray(payload?.warnings)
      ? payload.warnings.filter((value): value is string => typeof value === "string").slice(0, 10)
      : [];
    const serviceMetadata =
      payload?.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? payload.metadata as Record<string, unknown>
        : {};

    if (!text) {
      throw new KnowledgeIngestionSafetyError(
        "empty_extracted_text",
        "No readable text was found in the extracted document.",
        true,
        {
          extraction: {
            status: "empty",
            extractor,
            extractedAt,
            warnings
          }
        }
      );
    }

    return {
      text,
      metadata: {
        status: "completed",
        extractor,
        contentKind: "document",
        extractedAt,
        title: typeof payload?.title === "string" && payload.title.trim() ? payload.title.trim() : null,
        warnings,
        serviceMetadata
      }
    };
  } catch (error) {
    if (error instanceof KnowledgeIngestionSafetyError) {
      throw error;
    }
    throw new KnowledgeIngestionSafetyError(
      "knowledge_extractor_unavailable",
      "Knowledge document extractor could not be reached.",
      false,
      {
        extraction: {
          status: "unavailable",
          extractor: extractorUrl,
          extractedAt,
          detail: error instanceof Error ? error.message : "Unknown extractor error"
        }
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function extractMalwareScanDetails(error: unknown): KnowledgeMalwareScanResult | null {
  if (!(error instanceof KnowledgeIngestionSafetyError)) {
    return null;
  }
  const value = error.details?.malwareScan;
  if (!value || typeof value !== "object") {
    return null;
  }
  const scan = value as Partial<KnowledgeMalwareScanResult>;
  if (typeof scan.status !== "string" || typeof scan.scanner !== "string") {
    return null;
  }
  return {
    status: scan.status === "clean" || scan.status === "infected" || scan.status === "skipped"
      ? scan.status
      : "unavailable",
    scanner: scan.scanner,
    scannedAt: typeof scan.scannedAt === "string" ? scan.scannedAt : new Date().toISOString(),
    signature: scan.signature ?? null,
    detail: scan.detail ?? null
  };
}

async function storeKnowledgeQuarantineBlob(input: {
  tenantId: string;
  fileName: string;
  contentType: string;
  checksumSha256: string;
  reasonCode: string;
  buffer?: Buffer | null;
}) {
  const config = getQuarantineStorageConfig();
  if (!config.enabled) {
    return {
      status: "disabled",
      required: false,
      reason: "AI_KNOWLEDGE_QUARANTINE_STORE_BLOBS is not enabled"
    };
  }

  const storedAt = new Date().toISOString();
  const key = [
    config.prefix,
    "tenants",
    sanitizeObjectKeySegment(input.tenantId, "unknown-tenant", 128),
    storedAt.slice(0, 10),
    `${input.checksumSha256.slice(0, 16)}-${randomUUID()}-${sanitizeObjectKeySegment(input.fileName, "upload.bin", 180)}`
  ].join("/");

  if (!input.buffer) {
    return {
      status: "failed",
      provider: "r2",
      bucket: config.bucket,
      key,
      storedAt,
      required: config.required,
      error: "Original bytes unavailable for quarantine storage"
    };
  }

  if (config.missing.length > 0 || !config.bucket) {
    return {
      status: "failed",
      provider: "r2",
      bucket: config.bucket,
      key,
      storedAt,
      required: config.required,
      error: `Missing quarantine object storage config: ${config.missing.join(", ")}`
    };
  }

  try {
    await putObject({
      key,
      body: input.buffer,
      contentType: input.contentType || "application/octet-stream"
    });
    return {
      status: "stored",
      provider: "r2",
      bucket: config.bucket,
      key,
      storedAt
    };
  } catch (error) {
    return {
      status: "failed",
      provider: "r2",
      bucket: config.bucket,
      key,
      storedAt,
      required: config.required,
      error: error instanceof Error ? error.message : "Unknown quarantine object storage error"
    };
  }
}

export async function recordKnowledgeQuarantineEvent(input: {
  tenantId: string;
  documentId?: string | null;
  documentVersionId?: string | null;
  ingestionJobId?: string | null;
  fileName: string;
  contentType: string;
  checksumSha256: string;
  sizeBytes: number;
  reasonCode: string;
  detail?: string | null;
  malwareScan?: KnowledgeMalwareScanResult | null;
  buffer?: Buffer | null;
  metadata?: Record<string, unknown> | null;
}) {
  const quarantineBlob = await storeKnowledgeQuarantineBlob({
    tenantId: input.tenantId,
    fileName: input.fileName,
    contentType: input.contentType,
    checksumSha256: input.checksumSha256,
    reasonCode: input.reasonCode,
    buffer: input.buffer
  });
  const storageProvider = quarantineBlob.status === "stored" ? quarantineBlob.provider : null;
  const storageBucket = quarantineBlob.status === "stored" ? quarantineBlob.bucket : null;
  const storageKey = quarantineBlob.status === "stored" ? quarantineBlob.key : null;
  const storedAt = quarantineBlob.status === "stored" ? quarantineBlob.storedAt : null;

  const result = await db.query<KnowledgeQuarantineEvent>(
    `INSERT INTO knowledge_quarantine_events (
       tenant_id, document_id, document_version_id, ingestion_job_id,
       original_filename, content_type, checksum_sha256, size_bytes,
       reason_code, scanner_status, scanner, scanner_signature, detail,
       storage_provider, storage_bucket, storage_key, stored_at, metadata
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb
     )
     RETURNING id, tenant_id, document_id, document_version_id, ingestion_job_id,
               original_filename, content_type, checksum_sha256, size_bytes,
               reason_code, scanner_status, scanner, scanner_signature, detail,
               storage_provider, storage_bucket, storage_key, stored_at, metadata, created_at`,
    [
      input.tenantId,
      input.documentId ?? null,
      input.documentVersionId ?? null,
      input.ingestionJobId ?? null,
      sanitizeFileName(input.fileName),
      normalizeContentType(input.contentType),
      input.checksumSha256,
      input.sizeBytes,
      input.reasonCode.slice(0, 120),
      input.malwareScan?.status ?? "not_scanned",
      input.malwareScan?.scanner ?? null,
      input.malwareScan?.signature ?? null,
      input.detail?.slice(0, 1000) ?? null,
      storageProvider,
      storageBucket,
      storageKey,
      storedAt,
      JSON.stringify({
        ...(input.metadata ?? {}),
        quarantineBlob
      })
    ]
  );

  return result.rows[0];
}

export async function listKnowledgeQuarantineEvents(
  tenantId: string,
  { limit = 25 }: { limit?: number } = {}
) {
  const normalizedLimit = Math.min(Math.max(limit, 1), 100);
  const result = await db.query<KnowledgeQuarantineEvent>(
    `SELECT id, tenant_id, document_id, document_version_id, ingestion_job_id,
            original_filename, content_type, checksum_sha256, size_bytes,
            reason_code, scanner_status, scanner, scanner_signature, detail,
            storage_provider, storage_bucket, storage_key, stored_at, metadata, created_at
     FROM knowledge_quarantine_events
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, normalizedLimit]
  );
  return result.rows;
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
  const scopedTenantId = tenantId?.trim();
  if (!scopedTenantId) {
    throw new Error("Lock pending knowledge ingestion jobs requires tenantId");
  }
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
           AND tenant_id = $3::uuid
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
      [normalizedLimit, processingRecoverySeconds, scopedTenantId, lockedBy.slice(0, 120)]
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
  chunks,
  metadata
}: {
  tenantId: string;
  jobId: string;
  documentVersionId: string;
  attemptCount: number;
  extractedTextKey: string;
  chunks: KnowledgeChunkInput[];
  metadata?: Record<string, unknown>;
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
          ...(metadata ?? {}),
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
  const allowed = resolveAllowedFile(safeFileName, contentType, buffer);
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
