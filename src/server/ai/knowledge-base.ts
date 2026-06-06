import { createHash, randomUUID } from "crypto";
import {
  inspectAiInput,
  isAiGuardUnsafe,
  recordAiGuardEvent
} from "@/server/ai/guard";
import { db } from "@/server/db";
import { putObject } from "@/server/storage/r2";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

const MAX_KNOWLEDGE_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_DOCUMENTS_PER_WORKSPACE = 500;
const DEFAULT_MAX_BYTES_PER_WORKSPACE = 250 * 1024 * 1024;
const CHUNK_SIZE = 2200;
const CHUNK_OVERLAP = 250;
const DEFAULT_MALWARE_SCAN_TIMEOUT_MS = 5_000;
const DEFAULT_DOCUMENT_EXTRACTOR_TIMEOUT_MS = 15_000;
const DEFAULT_RETENTION_DAYS = 365;
const DEFAULT_QUARANTINE_PREFIX = "ai-knowledge/quarantine";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);
const TEXT_CONTENT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/octet-stream"
]);
const EXTRACTABLE_DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);
const EXTRACTABLE_DOCUMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export class KnowledgeUploadError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown> | null;

  constructor(code: string, message: string, status = 400, details: Record<string, unknown> | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type KnowledgeFolder = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  parent_id: string | null;
  name: string;
  created_at: Date;
  updated_at: Date;
};

export type KnowledgeDocument = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  folder_id: string | null;
  filename: string;
  title: string | null;
  content_type: string;
  checksum_sha256: string;
  byte_size: number;
  status: string;
  extraction_status: string;
  extraction_error: string | null;
  metadata: Record<string, unknown>;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type KnowledgeRetrievalResult = {
  documentId: string;
  chunkId: string;
  title: string | null;
  filename: string;
  content: string;
  score: number;
  chunkIndex: number;
};

export type KnowledgeRetrievalEvent = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  query: string;
  result_count: number;
  metadata: Record<string, unknown>;
  created_at: Date;
};

export type KnowledgeQuarantineEvent = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  filename: string;
  content_type: string;
  checksum_sha256: string;
  byte_size: number;
  reason_code: string;
  scanner_status: string;
  scanner: string | null;
  scanner_signature: string | null;
  detail: string | null;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  stored_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
};

export type KnowledgeRetentionDocument = {
  id: string;
  filename: string;
  title: string | null;
  status: string;
  byteSize: number;
  expiresAt: string;
  legalHold: boolean;
};

export type KnowledgeRetentionSweepResult = {
  dryRun: boolean;
  cutoffAt: string;
  matched: number;
  deleted: number;
  skippedLegalHold: number;
  documents: KnowledgeRetentionDocument[];
};

export type KnowledgeMalwareScanResult = {
  status: "clean" | "infected" | "unavailable" | "skipped";
  scanner: string;
  scannedAt: string;
  signature?: string | null;
  detail?: string | null;
};

type KnowledgeExtractionResult = {
  text: string;
  metadata: Record<string, unknown>;
};

export type KnowledgeExportChunk = {
  id: string;
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type KnowledgeExportDocument = {
  id: string;
  folderId: string | null;
  filename: string;
  title: string | null;
  contentType: string;
  checksumSha256: string;
  byteSize: number;
  status: string;
  extractionStatus: string;
  extractionError: string | null;
  metadata: Record<string, unknown>;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  bodyText?: string;
  chunks: KnowledgeExportChunk[];
};

export type KnowledgeExportBundle = {
  formatVersion: "ai-knowledge-export.v1";
  exportId: string;
  tenantKey: string;
  workspaceKey: string;
  generatedAt: string;
  includeDeleted: boolean;
  includeBodyText: boolean;
  documentCount: number;
  chunkCount: number;
  folders: KnowledgeFolder[];
  documents: KnowledgeExportDocument[];
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

type KnowledgeScope = {
  tenantKey?: string | null;
  workspaceKey?: string | null;
};

function resolveTenantKey(value?: string | null) {
  return value?.trim() || "primary";
}

function resolveWorkspaceKey(value?: string | null) {
  return value?.trim() || DEFAULT_WORKSPACE_KEY;
}

function getExtension(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function normalizeContentType(value: string | null | undefined) {
  return value?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

function isTextKnowledgeFile(filename: string, contentType: string) {
  return TEXT_EXTENSIONS.has(getExtension(filename)) && TEXT_CONTENT_TYPES.has(contentType);
}

function isExtractableKnowledgeFile(filename: string, contentType: string) {
  return (
    EXTRACTABLE_DOCUMENT_EXTENSIONS.has(getExtension(filename)) &&
    EXTRACTABLE_DOCUMENT_CONTENT_TYPES.has(contentType)
  );
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNonNegativeIntegerEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function requiresMalwareScan() {
  const configured = process.env.AI_KNOWLEDGE_REQUIRE_MALWARE_SCAN;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}

function getMalwareScannerUrl() {
  return process.env.AI_KNOWLEDGE_MALWARE_SCAN_URL?.trim() || null;
}

function getDocumentExtractorUrl() {
  return process.env.AI_KNOWLEDGE_DOCUMENT_EXTRACTOR_URL?.trim() || null;
}

function buildKnowledgeRetentionMetadata() {
  const days = readNonNegativeIntegerEnv("AI_KNOWLEDGE_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
  const uploadedAt = new Date();
  const expiresAt = days > 0
    ? new Date(uploadedAt.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
    : null;
  return {
    policy: process.env.AI_KNOWLEDGE_RETENTION_POLICY?.trim() || "standard",
    retentionDays: days,
    uploadedAt: uploadedAt.toISOString(),
    expiresAt,
    legalHold: false
  };
}

function parseRetentionMetadata(metadata: Record<string, unknown> | null | undefined) {
  const retention = metadata?.retention;
  if (!retention || typeof retention !== "object") {
    return null;
  }
  const value = retention as { expiresAt?: unknown; legalHold?: unknown };
  if (typeof value.expiresAt !== "string" || !value.expiresAt.trim()) {
    return null;
  }
  const expiresAt = new Date(value.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return null;
  }
  return {
    expiresAt,
    legalHold: value.legalHold === true
  };
}

type KnowledgeQuarantineBlobStorageResult =
  | {
      status: "disabled";
      required: boolean;
      reason: string;
    }
  | {
      status: "stored";
      provider: "r2";
      bucket: string;
      key: string;
      storedAt: string;
    }
  | {
      status: "failed";
      provider: "r2";
      bucket: string | null;
      key: string | null;
      storedAt: string;
      required: boolean;
      error: string;
    };

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

function sanitizeObjectMetadataValue(value: string | null | undefined) {
  return (value ?? "").replace(/[\r\n]/g, " ").replace(/[^\t\x20-\x7E]/g, " ").slice(0, 1024);
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

export function getKnowledgeIngestionReadiness(): KnowledgeIngestionReadiness {
  const scannerRequired = requiresMalwareScan();
  const scannerUrlConfigured = Boolean(getMalwareScannerUrl());
  const scannerStatus = scannerUrlConfigured
    ? "configured"
    : scannerRequired
      ? "required_unconfigured"
      : "optional_disabled";
  const extractorUrlConfigured = Boolean(getDocumentExtractorUrl());
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

async function storeKnowledgeQuarantineBlob(input: {
  tenantKey: string;
  workspaceKey: string;
  filename: string;
  contentType: string;
  checksumSha256: string;
  byteSize: number;
  reasonCode: string;
  bytes: Buffer;
}): Promise<KnowledgeQuarantineBlobStorageResult> {
  const config = getQuarantineStorageConfig();
  if (!config.enabled) {
    return {
      status: "disabled",
      required: false,
      reason: "AI_KNOWLEDGE_QUARANTINE_STORE_BLOBS is not enabled"
    };
  }

  const storedAt = new Date().toISOString();
  const tenantSegment = sanitizeObjectKeySegment(input.tenantKey, "unknown-tenant", 128);
  const workspaceSegment = sanitizeObjectKeySegment(input.workspaceKey, "unknown-workspace", 128);
  const filenameSegment = sanitizeObjectKeySegment(input.filename, "upload.bin", 180);
  const key = [
    config.prefix,
    "tenants",
    tenantSegment,
    "workspaces",
    workspaceSegment,
    storedAt.slice(0, 10),
    `${input.checksumSha256.slice(0, 16)}-${randomUUID()}-${filenameSegment}`
  ].join("/");

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
      body: input.bytes,
      contentType: input.contentType || "application/octet-stream",
      metadata: {
        "tenant-key": sanitizeObjectMetadataValue(input.tenantKey),
        "workspace-key": sanitizeObjectMetadataValue(input.workspaceKey),
        filename: sanitizeObjectMetadataValue(input.filename),
        "content-type": sanitizeObjectMetadataValue(input.contentType),
        "checksum-sha256": sanitizeObjectMetadataValue(input.checksumSha256),
        "reason-code": sanitizeObjectMetadataValue(input.reasonCode)
      }
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

function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]/g, " ").slice(0, 500);
}

function normalizeText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

async function extractKnowledgeText(input: {
  filename: string;
  contentType: string;
  checksumSha256: string;
  bytes: Buffer;
}): Promise<KnowledgeExtractionResult> {
  if (isTextKnowledgeFile(input.filename, input.contentType)) {
    const text = normalizeText(new TextDecoder("utf-8", { fatal: false }).decode(input.bytes));
    if (!text) {
      throw new KnowledgeUploadError("empty_extracted_text", "No readable text was found.", 422, {
        extraction: {
          status: "empty",
          extractor: "inline_text"
        }
      });
    }
    return {
      text,
      metadata: {
        status: "completed",
        extractor: "inline_text",
        contentKind: "text",
        extractedAt: new Date().toISOString()
      }
    };
  }

  const extractorUrl = getDocumentExtractorUrl();
  const extractedAt = new Date().toISOString();
  if (!extractorUrl) {
    throw new KnowledgeUploadError(
      "knowledge_extractor_unconfigured",
      "PDF and Word knowledge uploads require a configured document extractor service.",
      503,
      {
        extraction: {
          status: "unavailable",
          extractor: "unconfigured",
          extractedAt
        }
      }
    );
  }

  const timeoutMs = readPositiveIntegerEnv(
    "AI_KNOWLEDGE_DOCUMENT_EXTRACTOR_TIMEOUT_MS",
    DEFAULT_DOCUMENT_EXTRACTOR_TIMEOUT_MS
  );
  const body = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength
  ) as ArrayBuffer;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(extractorUrl, {
      method: "POST",
      headers: {
        "content-type": input.contentType || "application/octet-stream",
        "x-knowledge-filename": sanitizeHeaderValue(input.filename),
        "x-knowledge-checksum-sha256": sanitizeHeaderValue(input.checksumSha256)
      },
      body,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new KnowledgeUploadError(
        "knowledge_extractor_unavailable",
        `Knowledge document extractor returned HTTP ${response.status}.`,
        503,
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
    const text = normalizeText(typeof payload?.text === "string" ? payload.text : "");
    const extractor = payload?.extractor?.trim() || extractorUrl;
    const warnings = Array.isArray(payload?.warnings)
      ? payload.warnings.filter((value): value is string => typeof value === "string").slice(0, 10)
      : [];
    const serviceMetadata = payload?.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? payload.metadata as Record<string, unknown>
      : {};
    if (!text) {
      throw new KnowledgeUploadError(
        "empty_extracted_text",
        "No readable text was found in the extracted document.",
        422,
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
    if (error instanceof KnowledgeUploadError) {
      throw error;
    }
    throw new KnowledgeUploadError(
      "knowledge_extractor_unavailable",
      "Knowledge document extractor could not be reached.",
      503,
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

function chunkText(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE, normalized.length);
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks.filter(Boolean);
}

export function detectKnowledgeSafetyFindings(text: string) {
  return inspectAiInput({ text }).reasonCodes;
}

async function enforceKnowledgeSafety(input: {
  tenantKey: string;
  workspaceKey: string;
  sourceKind: "knowledge_upload" | "knowledge_retrieval_query" | "knowledge_retrieval_result";
  sourceId?: string | null;
  subject?: string | null;
  text: string;
  metadata?: Record<string, unknown> | null;
}) {
  const inspection = inspectAiInput({ text: input.text });
  if (!isAiGuardUnsafe(inspection)) {
    return inspection;
  }

  await recordAiGuardEvent({
    tenantKey: input.tenantKey,
    workspaceKey: input.workspaceKey,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    subject: input.subject,
    inspection,
    metadata: input.metadata
  });

  throw new KnowledgeUploadError(
    "prompt_injection_detected",
    `Knowledge input contains unsafe AI-control language: ${inspection.reasonCodes.join(", ")}.`,
    422
  );
}

export async function scanKnowledgeUploadForMalware(input: {
  filename: string;
  contentType: string;
  checksumSha256: string;
  bytes: Buffer;
}): Promise<KnowledgeMalwareScanResult> {
  const scannerUrl = getMalwareScannerUrl();
  const scannedAt = new Date().toISOString();
  if (!scannerUrl) {
    if (requiresMalwareScan()) {
      throw new KnowledgeUploadError(
        "malware_scanner_unconfigured",
        "Knowledge uploads require a configured malware scanner in this environment.",
        503,
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
      detail: "Malware scanning is disabled outside production."
    };
  }

  const timeoutMs = readPositiveIntegerEnv(
    "AI_KNOWLEDGE_MALWARE_SCAN_TIMEOUT_MS",
    DEFAULT_MALWARE_SCAN_TIMEOUT_MS
  );
  const scanBody = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength
  ) as ArrayBuffer;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(scannerUrl, {
      method: "POST",
      headers: {
        "content-type": input.contentType || "application/octet-stream",
        "x-knowledge-filename": sanitizeHeaderValue(input.filename),
        "x-knowledge-checksum-sha256": sanitizeHeaderValue(input.checksumSha256)
      },
      body: scanBody,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new KnowledgeUploadError(
        "malware_scan_unavailable",
        `Knowledge malware scanner returned HTTP ${response.status}.`,
        503,
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
      throw new KnowledgeUploadError(
        scanResult.status === "infected" ? "malware_detected" : "malware_scan_unavailable",
        scanResult.status === "infected"
          ? "Knowledge upload was rejected by the malware scanner."
          : "Knowledge malware scanner returned an indeterminate result.",
        scanResult.status === "infected" ? 422 : 503,
        { malwareScan: scanResult }
      );
    }
    return scanResult;
  } catch (error) {
    if (error instanceof KnowledgeUploadError) {
      throw error;
    }
    throw new KnowledgeUploadError(
      "malware_scan_unavailable",
      "Knowledge malware scanner could not be reached.",
      503,
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

function extractMalwareScanDetails(error: KnowledgeUploadError): KnowledgeMalwareScanResult | null {
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

async function recordKnowledgeQuarantineEvent(input: {
  tenantKey: string;
  workspaceKey: string;
  filename: string;
  contentType: string;
  checksumSha256: string;
  byteSize: number;
  reasonCode: string;
  detail?: string | null;
  malwareScan?: KnowledgeMalwareScanResult | null;
  bytes: Buffer;
  metadata?: Record<string, unknown> | null;
}) {
  const quarantineBlob = await storeKnowledgeQuarantineBlob({
    tenantKey: input.tenantKey,
    workspaceKey: input.workspaceKey,
    filename: input.filename,
    contentType: input.contentType,
    checksumSha256: input.checksumSha256,
    byteSize: input.byteSize,
    reasonCode: input.reasonCode,
    bytes: input.bytes
  });
  const storageProvider = quarantineBlob.status === "stored" ? quarantineBlob.provider : null;
  const storageBucket = quarantineBlob.status === "stored" ? quarantineBlob.bucket : null;
  const storageKey = quarantineBlob.status === "stored" ? quarantineBlob.key : null;
  const storedAt = quarantineBlob.status === "stored" ? quarantineBlob.storedAt : null;

  await db.query(
    `INSERT INTO ai_knowledge_quarantine_events (
       tenant_key,
       workspace_key,
       filename,
       content_type,
       checksum_sha256,
       byte_size,
       reason_code,
       scanner_status,
       scanner,
       scanner_signature,
       detail,
       storage_provider,
       storage_bucket,
       storage_key,
       stored_at,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      input.tenantKey,
      input.workspaceKey,
      input.filename,
      input.contentType,
      input.checksumSha256,
      input.byteSize,
      input.reasonCode,
      input.malwareScan?.status ?? "not_scanned",
      input.malwareScan?.scanner ?? null,
      input.malwareScan?.signature ?? null,
      input.detail ?? null,
      storageProvider,
      storageBucket,
      storageKey,
      storedAt,
      {
        ...(input.metadata ?? {}),
        quarantineBlob
      }
    ]
  );
}

async function assertKnowledgeQuota(input: {
  tenantKey: string;
  workspaceKey: string;
  incomingBytes: number;
}) {
  const maxDocuments = readPositiveIntegerEnv(
    "AI_KNOWLEDGE_MAX_DOCUMENTS_PER_WORKSPACE",
    DEFAULT_MAX_DOCUMENTS_PER_WORKSPACE
  );
  const maxBytes = readPositiveIntegerEnv(
    "AI_KNOWLEDGE_MAX_BYTES_PER_WORKSPACE",
    DEFAULT_MAX_BYTES_PER_WORKSPACE
  );
  const result = await db.query<{ document_count: string; total_bytes: string }>(
    `SELECT COUNT(*)::text AS document_count,
            COALESCE(SUM(byte_size), 0)::text AS total_bytes
     FROM ai_knowledge_documents
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND status <> 'deleted'`,
    [input.tenantKey, input.workspaceKey]
  );
  const currentDocuments = Number.parseInt(result.rows[0]?.document_count ?? "0", 10);
  const currentBytes = Number.parseInt(result.rows[0]?.total_bytes ?? "0", 10);

  if (currentDocuments >= maxDocuments) {
    throw new KnowledgeUploadError(
      "knowledge_document_quota_exceeded",
      `Knowledge document quota exceeded for workspace ${input.workspaceKey}.`,
      429
    );
  }

  if (currentBytes + input.incomingBytes > maxBytes) {
    throw new KnowledgeUploadError(
      "knowledge_storage_quota_exceeded",
      `Knowledge storage quota exceeded for workspace ${input.workspaceKey}.`,
      429
    );
  }
}

async function assertKnowledgeFolderInScope(input: {
  tenantKey: string;
  workspaceKey: string;
  folderId?: string | null;
}) {
  if (!input.folderId) {
    return;
  }

  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM ai_knowledge_folders
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
     LIMIT 1`,
    [input.folderId, input.tenantKey, input.workspaceKey]
  );
  if (!result.rows[0]) {
    throw new KnowledgeUploadError(
      "knowledge_folder_not_found",
      "Knowledge folder was not found in this workspace.",
      404
    );
  }
}

export function assertSupportedKnowledgeFile(input: {
  filename: string;
  contentType?: string | null;
  byteLength: number;
  bytes: Buffer;
}) {
  const filename = input.filename.trim();
  if (!filename) {
    throw new KnowledgeUploadError("invalid_filename", "Filename is required.");
  }
  if (input.byteLength <= 0) {
    throw new KnowledgeUploadError("empty_file", "Knowledge files cannot be empty.");
  }
  if (input.byteLength > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new KnowledgeUploadError(
      "file_too_large",
      `Knowledge files must be ${MAX_KNOWLEDGE_FILE_BYTES} bytes or smaller.`,
      413
    );
  }

  const extension = getExtension(filename);
  const contentType = normalizeContentType(input.contentType);
  const textFile = isTextKnowledgeFile(filename, contentType);
  const extractableFile = isExtractableKnowledgeFile(filename, contentType);

  if (!textFile && !extractableFile) {
    throw new KnowledgeUploadError(
      "unsupported_content_type",
      "Only plain text, Markdown, PDF, DOC, and DOCX knowledge files are supported.",
      415
    );
  }

  if (textFile && input.bytes.includes(0)) {
    throw new KnowledgeUploadError(
      "binary_content_rejected",
      "Binary-looking content is rejected until the malware scanner and extractor pipeline are configured.",
      415
    );
  }
}

export async function listKnowledgeFolders(scope: KnowledgeScope = {}) {
  const tenantKey = resolveTenantKey(scope.tenantKey);
  const workspaceKey = resolveWorkspaceKey(scope.workspaceKey);
  const result = await db.query<KnowledgeFolder>(
    `SELECT id, tenant_key, workspace_key, parent_id, name, created_at, updated_at
     FROM ai_knowledge_folders
     WHERE tenant_key = $1
       AND workspace_key = $2
     ORDER BY parent_id NULLS FIRST, lower(name) ASC`,
    [tenantKey, workspaceKey]
  );
  return result.rows;
}

export async function createKnowledgeFolder(input: KnowledgeScope & {
  name: string;
  parentId?: string | null;
}) {
  const tenantKey = resolveTenantKey(input.tenantKey);
  const workspaceKey = resolveWorkspaceKey(input.workspaceKey);
  const name = input.name.trim();
  if (!name) {
    throw new KnowledgeUploadError("invalid_folder_name", "Folder name is required.");
  }
  await assertKnowledgeFolderInScope({
    tenantKey,
    workspaceKey,
    folderId: input.parentId
  });

  const result = await db.query<KnowledgeFolder>(
    `INSERT INTO ai_knowledge_folders (tenant_key, workspace_key, parent_id, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id, tenant_key, workspace_key, parent_id, name, created_at, updated_at`,
    [tenantKey, workspaceKey, input.parentId ?? null, name]
  );
  if (result.rows[0]) {
    return result.rows[0];
  }
  const existing = await db.query<KnowledgeFolder>(
    `SELECT id, tenant_key, workspace_key, parent_id, name, created_at, updated_at
     FROM ai_knowledge_folders
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       AND lower(name) = lower($4)
     LIMIT 1`,
    [tenantKey, workspaceKey, input.parentId ?? null, name]
  );
  return existing.rows[0];
}

export async function listKnowledgeDocuments(scope: KnowledgeScope = {}) {
  const tenantKey = resolveTenantKey(scope.tenantKey);
  const workspaceKey = resolveWorkspaceKey(scope.workspaceKey);
  const result = await db.query<KnowledgeDocument>(
    `SELECT id,
            tenant_key,
            workspace_key,
            folder_id,
            filename,
            title,
            content_type,
            checksum_sha256,
            byte_size,
            status,
            extraction_status,
            extraction_error,
            metadata,
            published_at,
            created_at,
            updated_at
     FROM ai_knowledge_documents
     WHERE tenant_key = $1
       AND workspace_key = $2
     ORDER BY updated_at DESC
     LIMIT 200`,
    [tenantKey, workspaceKey]
  );
  return result.rows;
}

export async function listKnowledgeRetrievalEvents(
  scope: KnowledgeScope = {},
  options: { limit?: number } = {}
) {
  const tenantKey = resolveTenantKey(scope.tenantKey);
  const workspaceKey = resolveWorkspaceKey(scope.workspaceKey);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const result = await db.query<KnowledgeRetrievalEvent>(
    `SELECT id,
            tenant_key,
            workspace_key,
            query,
            result_count,
            metadata,
            created_at
     FROM ai_knowledge_retrieval_events
     WHERE tenant_key = $1
       AND workspace_key = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [tenantKey, workspaceKey, limit]
  );
  return result.rows;
}

export async function listKnowledgeQuarantineEvents(
  scope: KnowledgeScope = {},
  options: { limit?: number } = {}
) {
  const tenantKey = resolveTenantKey(scope.tenantKey);
  const workspaceKey = resolveWorkspaceKey(scope.workspaceKey);
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const result = await db.query<KnowledgeQuarantineEvent>(
    `SELECT id,
            tenant_key,
            workspace_key,
            filename,
            content_type,
            checksum_sha256,
            byte_size,
            reason_code,
            scanner_status,
            scanner,
            scanner_signature,
            detail,
            storage_provider,
            storage_bucket,
            storage_key,
            stored_at,
            metadata,
            created_at
     FROM ai_knowledge_quarantine_events
     WHERE tenant_key = $1
       AND workspace_key = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [tenantKey, workspaceKey, limit]
  );
  return result.rows;
}

export async function runKnowledgeRetentionSweep(
  scope: KnowledgeScope = {},
  options: {
    dryRun?: boolean;
    limit?: number;
    cutoffAt?: Date;
    actorUserId?: string | null;
  } = {}
): Promise<KnowledgeRetentionSweepResult> {
  const tenantKey = resolveTenantKey(scope.tenantKey);
  const workspaceKey = resolveWorkspaceKey(scope.workspaceKey);
  const dryRun = options.dryRun !== false;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const cutoffAt = options.cutoffAt ?? new Date();
  const result = await db.query<Pick<KnowledgeDocument, "id" | "filename" | "title" | "status" | "byte_size" | "metadata">>(
    `SELECT id,
            filename,
            title,
            status,
            byte_size,
            metadata
     FROM ai_knowledge_documents
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND status <> 'deleted'
       AND metadata #>> '{retention,expiresAt}' IS NOT NULL
     ORDER BY updated_at ASC
     LIMIT $3`,
    [tenantKey, workspaceKey, limit * 4]
  );

  const expired = result.rows.flatMap((row) => {
    const retention = parseRetentionMetadata(row.metadata);
    if (!retention || retention.expiresAt > cutoffAt) {
      return [];
    }
    return [{
      id: row.id,
      filename: row.filename,
      title: row.title,
      status: row.status,
      byteSize: row.byte_size,
      expiresAt: retention.expiresAt.toISOString(),
      legalHold: retention.legalHold
    }];
  });
  const legalHoldDocuments = expired.filter((document) => document.legalHold);
  const documents = expired.filter((document) => !document.legalHold).slice(0, limit);

  if (dryRun || documents.length === 0) {
    return {
      dryRun,
      cutoffAt: cutoffAt.toISOString(),
      matched: documents.length,
      deleted: 0,
      skippedLegalHold: legalHoldDocuments.length,
      documents
    };
  }

  const ids = documents.map((document) => document.id);
  const deletedAt = new Date().toISOString();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM ai_knowledge_chunks
       WHERE tenant_key = $1
         AND workspace_key = $2
         AND document_id = ANY($3::uuid[])`,
      [tenantKey, workspaceKey, ids]
    );
    const updateResult = await client.query<{ id: string }>(
      `UPDATE ai_knowledge_documents
       SET status = 'deleted',
           body_text = '',
           published_at = NULL,
           extraction_error = 'retention_expired',
           metadata = jsonb_set(
             jsonb_set(metadata, '{retention,deletedAt}', to_jsonb($4::text), true),
             '{retention,deletedReason}',
             to_jsonb('retention_expired'::text),
             true
           ),
           updated_at = now()
       WHERE tenant_key = $1
         AND workspace_key = $2
         AND id = ANY($3::uuid[])
       RETURNING id`,
      [tenantKey, workspaceKey, ids, deletedAt]
    );
    for (const document of documents) {
      await client.query(
        `INSERT INTO audit_logs (
           tenant_key,
           workspace_key,
           actor_user_id,
           action,
           entity_type,
           entity_id,
           data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantKey,
          workspaceKey,
          options.actorUserId ?? null,
          "ai_knowledge_document_retention_deleted",
          "ai_knowledge_document",
          document.id,
          {
            filename: document.filename,
            title: document.title,
            byteSize: document.byteSize,
            expiresAt: document.expiresAt,
            deletedAt
          }
        ]
      );
    }
    await client.query("COMMIT");
    return {
      dryRun: false,
      cutoffAt: cutoffAt.toISOString(),
      matched: documents.length,
      deleted: updateResult.rowCount ?? documents.length,
      skippedLegalHold: legalHoldDocuments.length,
      documents
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function exportKnowledgeBundle(
  scope: KnowledgeScope = {},
  options: {
    includeDeleted?: boolean;
    includeBodyText?: boolean;
    limit?: number;
  } = {}
): Promise<KnowledgeExportBundle> {
  const tenantKey = resolveTenantKey(scope.tenantKey);
  const workspaceKey = resolveWorkspaceKey(scope.workspaceKey);
  const includeDeleted = options.includeDeleted === true;
  const includeBodyText = options.includeBodyText !== false;
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const [folders, documents] = await Promise.all([
    listKnowledgeFolders({ tenantKey, workspaceKey }),
    db.query<KnowledgeDocument & { body_text: string | null }>(
      `SELECT id,
              tenant_key,
              workspace_key,
              folder_id,
              filename,
              title,
              content_type,
              checksum_sha256,
              byte_size,
              status,
              extraction_status,
              extraction_error,
              metadata,
              published_at,
              created_at,
              updated_at,
              ${includeBodyText ? "body_text" : "NULL::text AS body_text"}
       FROM ai_knowledge_documents
       WHERE tenant_key = $1
         AND workspace_key = $2
         AND ($3::boolean OR status <> 'deleted')
       ORDER BY updated_at DESC
       LIMIT $4`,
      [tenantKey, workspaceKey, includeDeleted, limit]
    )
  ]);
  const documentIds = documents.rows.map((document) => document.id);
  const chunks = documentIds.length > 0
    ? await db.query<{
        id: string;
        document_id: string;
        chunk_index: number;
        content: string;
        token_estimate: number;
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT id,
                document_id,
                chunk_index,
                content,
                token_estimate,
                metadata,
                created_at
         FROM ai_knowledge_chunks
         WHERE tenant_key = $1
           AND workspace_key = $2
           AND document_id = ANY($3::uuid[])
         ORDER BY document_id, chunk_index ASC`,
        [tenantKey, workspaceKey, documentIds]
      )
    : { rows: [] };
  const chunksByDocument = new Map<string, KnowledgeExportChunk[]>();
  for (const chunk of chunks.rows) {
    const current = chunksByDocument.get(chunk.document_id) ?? [];
    current.push({
      id: chunk.id,
      chunkIndex: chunk.chunk_index,
      content: chunk.content,
      tokenEstimate: chunk.token_estimate,
      metadata: chunk.metadata,
      createdAt: chunk.created_at
    });
    chunksByDocument.set(chunk.document_id, current);
  }
  const exportedDocuments = documents.rows.map((document) => ({
    id: document.id,
    folderId: document.folder_id,
    filename: document.filename,
    title: document.title,
    contentType: document.content_type,
    checksumSha256: document.checksum_sha256,
    byteSize: document.byte_size,
    status: document.status,
    extractionStatus: document.extraction_status,
    extractionError: document.extraction_error,
    metadata: document.metadata,
    publishedAt: document.published_at,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
    ...(includeBodyText ? { bodyText: document.body_text ?? "" } : {}),
    chunks: chunksByDocument.get(document.id) ?? []
  }));

  return {
    formatVersion: "ai-knowledge-export.v1",
    exportId: randomUUID(),
    tenantKey,
    workspaceKey,
    generatedAt: new Date().toISOString(),
    includeDeleted,
    includeBodyText,
    documentCount: exportedDocuments.length,
    chunkCount: exportedDocuments.reduce((total, document) => total + document.chunks.length, 0),
    folders,
    documents: exportedDocuments
  };
}

export async function ingestKnowledgeDocument(input: KnowledgeScope & {
  filename: string;
  contentType?: string | null;
  bytes: Buffer;
  folderId?: string | null;
  title?: string | null;
  publish?: boolean;
  metadata?: Record<string, unknown> | null;
}) {
  const tenantKey = resolveTenantKey(input.tenantKey);
  const workspaceKey = resolveWorkspaceKey(input.workspaceKey);
  const contentType = normalizeContentType(input.contentType);
  const filename = input.filename.trim();
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const baseMetadata = input.metadata ?? {};

  let bodyText = "";
  let malwareScan: KnowledgeMalwareScanResult | null = null;
  let extractionMetadata: Record<string, unknown> = {};
  try {
    assertSupportedKnowledgeFile({
      filename: input.filename,
      contentType,
      byteLength: input.bytes.byteLength,
      bytes: input.bytes
    });

    await assertKnowledgeFolderInScope({
      tenantKey,
      workspaceKey,
      folderId: input.folderId
    });
    malwareScan = await scanKnowledgeUploadForMalware({
      filename,
      contentType,
      checksumSha256: checksum,
      bytes: input.bytes
    });
    const extraction = await extractKnowledgeText({
      filename,
      contentType,
      checksumSha256: checksum,
      bytes: input.bytes
    });
    bodyText = extraction.text;
    extractionMetadata = extraction.metadata;
    await enforceKnowledgeSafety({
      tenantKey,
      workspaceKey,
      sourceKind: "knowledge_upload",
      subject: input.filename,
      text: bodyText,
      metadata: {
        ...baseMetadata,
        filename: input.filename,
        contentType,
        byteLength: input.bytes.byteLength,
        malwareScan,
        extraction: extractionMetadata
      }
    });
    await assertKnowledgeQuota({
      tenantKey,
      workspaceKey,
      incomingBytes: input.bytes.byteLength
    });
  } catch (error) {
    if (error instanceof KnowledgeUploadError) {
      await recordKnowledgeQuarantineEvent({
        tenantKey,
        workspaceKey,
        filename: filename || input.filename || "unknown",
        contentType,
        checksumSha256: checksum,
        byteSize: input.bytes.byteLength,
        reasonCode: error.code,
        detail: error.message,
        malwareScan: extractMalwareScanDetails(error),
        bytes: input.bytes,
        metadata: {
          ...baseMetadata,
          folderId: input.folderId ?? null,
          title: input.title ?? null,
          failureDetails: error.details ?? null
        }
      });
    }
    throw error;
  }

  const chunks = chunkText(bodyText);
  if (!chunks.length) {
    throw new KnowledgeUploadError("empty_chunks", "No knowledge chunks could be created.");
  }
  const retention = buildKnowledgeRetentionMetadata();
  const documentMetadata = {
    ...baseMetadata,
    malwareScan,
    extraction: extractionMetadata,
    retention
  };

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const document = await client.query<KnowledgeDocument>(
      `INSERT INTO ai_knowledge_documents (
         tenant_key,
         workspace_key,
         folder_id,
         filename,
         title,
         content_type,
         checksum_sha256,
         byte_size,
         status,
         extraction_status,
         body_text,
         metadata,
         published_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, 'completed', $10, $11, ${input.publish ? "now()" : "NULL"}
       )
       RETURNING id,
                 tenant_key,
                 workspace_key,
                 folder_id,
                 filename,
                 title,
                 content_type,
                 checksum_sha256,
                 byte_size,
                 status,
                 extraction_status,
                 extraction_error,
                 metadata,
                 published_at,
                 created_at,
                 updated_at`,
      [
        tenantKey,
        workspaceKey,
        input.folderId ?? null,
        filename,
        input.title?.trim() || null,
        contentType,
        checksum,
        input.bytes.byteLength,
        input.publish ? "published" : "draft",
        bodyText,
        documentMetadata
      ]
    );
    const documentId = document.rows[0].id;
    for (let index = 0; index < chunks.length; index += 1) {
      const content = chunks[index];
      await client.query(
        `INSERT INTO ai_knowledge_chunks (
           document_id,
           tenant_key,
           workspace_key,
           chunk_index,
           content,
           token_estimate,
           metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          documentId,
          tenantKey,
          workspaceKey,
          index,
          content,
          estimateTokens(content),
          { filename: input.filename }
        ]
      );
    }
    await client.query("COMMIT");
    return document.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function publishKnowledgeDocument(input: KnowledgeScope & { documentId: string }) {
  const tenantKey = resolveTenantKey(input.tenantKey);
  const workspaceKey = resolveWorkspaceKey(input.workspaceKey);
  const result = await db.query<KnowledgeDocument>(
    `UPDATE ai_knowledge_documents
     SET status = 'published',
         published_at = COALESCE(published_at, now()),
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
     RETURNING id,
               tenant_key,
               workspace_key,
               folder_id,
               filename,
               title,
               content_type,
               checksum_sha256,
               byte_size,
               status,
               extraction_status,
               extraction_error,
               metadata,
               published_at,
               created_at,
               updated_at`,
    [input.documentId, tenantKey, workspaceKey]
  );
  return result.rows[0] ?? null;
}

export async function setKnowledgeDocumentLegalHold(input: KnowledgeScope & {
  documentId: string;
  legalHold: boolean;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  const tenantKey = resolveTenantKey(input.tenantKey);
  const workspaceKey = resolveWorkspaceKey(input.workspaceKey);
  const updatedAt = new Date().toISOString();
  const result = await db.query<KnowledgeDocument>(
    `UPDATE ai_knowledge_documents
     SET metadata = jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 CASE
                   WHEN metadata ? 'retention'
                    AND jsonb_typeof(metadata->'retention') = 'object'
                   THEN metadata
                   ELSE jsonb_set(metadata, '{retention}', '{}'::jsonb, true)
                 END,
                 '{retention,legalHold}',
                 to_jsonb($4::boolean),
                 true
               ),
               '{retention,legalHoldUpdatedAt}',
               to_jsonb($5::text),
               true
             ),
             '{retention,legalHoldReason}',
             COALESCE(to_jsonb($6::text), 'null'::jsonb),
             true
           ),
           '{retention,legalHoldActorUserId}',
           COALESCE(to_jsonb($7::text), 'null'::jsonb),
           true
         ),
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
       AND status <> 'deleted'
     RETURNING id,
               tenant_key,
               workspace_key,
               folder_id,
               filename,
               title,
               content_type,
               checksum_sha256,
               byte_size,
               status,
               extraction_status,
               extraction_error,
               metadata,
               published_at,
               created_at,
               updated_at`,
    [
      input.documentId,
      tenantKey,
      workspaceKey,
      input.legalHold,
      updatedAt,
      input.reason?.trim() || null,
      input.actorUserId ?? null
    ]
  );
  return result.rows[0] ?? null;
}

export async function retrieveKnowledge(input: KnowledgeScope & {
  query: string;
  limit?: number;
  metadata?: Record<string, unknown> | null;
}) {
  const tenantKey = resolveTenantKey(input.tenantKey);
  const workspaceKey = resolveWorkspaceKey(input.workspaceKey);
  const query = input.query.trim();
  if (!query) {
    throw new KnowledgeUploadError("empty_query", "Search query is required.");
  }
  await enforceKnowledgeSafety({
    tenantKey,
    workspaceKey,
    sourceKind: "knowledge_retrieval_query",
    subject: "knowledge_search_query",
    text: query,
    metadata: input.metadata
  });
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);

  const result = await db.query<{
    document_id: string;
    chunk_id: string;
    title: string | null;
    filename: string;
    content: string;
    rank: number | null;
    chunk_index: number;
  }>(
    `WITH search AS (
       SELECT websearch_to_tsquery('simple', $3) AS query
     )
     SELECT d.id AS document_id,
            c.id AS chunk_id,
            d.title,
            d.filename,
            c.content,
            ts_rank(to_tsvector('simple', c.content), search.query) AS rank,
            c.chunk_index
     FROM ai_knowledge_chunks c
     JOIN ai_knowledge_documents d ON d.id = c.document_id
     CROSS JOIN search
     WHERE c.tenant_key = $1
       AND c.workspace_key = $2
       AND d.status = 'published'
       AND (
         to_tsvector('simple', c.content) @@ search.query
         OR lower(c.content) LIKE '%' || lower($3) || '%'
       )
     ORDER BY rank DESC NULLS LAST, d.updated_at DESC, c.chunk_index ASC
     LIMIT $4`,
    [tenantKey, workspaceKey, query, limit]
  );

  const safeRows: typeof result.rows = [];
  let filteredUnsafeChunks = 0;
  for (const row of result.rows) {
    try {
      await enforceKnowledgeSafety({
        tenantKey,
        workspaceKey,
        sourceKind: "knowledge_retrieval_result",
        sourceId: row.chunk_id,
        subject: row.filename,
        text: row.content,
        metadata: {
          ...(input.metadata ?? {}),
          documentId: row.document_id,
          chunkIndex: row.chunk_index
        }
      });
      safeRows.push(row);
    } catch (error) {
      if (error instanceof KnowledgeUploadError && error.code === "prompt_injection_detected") {
        filteredUnsafeChunks += 1;
        continue;
      }
      throw error;
    }
  }

  await db.query(
    `INSERT INTO ai_knowledge_retrieval_events (
       tenant_key,
       workspace_key,
       query,
       result_count,
       metadata
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      tenantKey,
      workspaceKey,
      query,
      safeRows.length,
      {
        ...(input.metadata ?? {}),
        filteredUnsafeChunks
      }
    ]
  );

  return safeRows.map((row) => ({
    documentId: row.document_id,
    chunkId: row.chunk_id,
    title: row.title,
    filename: row.filename,
    content: row.content,
    score: Number(row.rank ?? 0),
    chunkIndex: row.chunk_index
  })) satisfies KnowledgeRetrievalResult[];
}
