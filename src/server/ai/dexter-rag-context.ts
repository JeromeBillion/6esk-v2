import {
  promptSafetyTelemetry,
  type PromptSafetyDecision
} from "@/server/ai/prompt-safety";
import {
  retrievePublishedKnowledge,
  type KnowledgeRetrievalCitation,
  type KnowledgeRetrievalOutcome
} from "@/server/ai/knowledge-retrieval";
import type { KnowledgeRetrievalSafetySummary } from "@/server/ai/knowledge-safety";

const DEXTER_RAG_SCHEMA = "dexter_rag_context.v1";
const DEXTER_RAG_QUERY_PURPOSE = "dexter_runtime_context";
const DEFAULT_MAX_DEXTER_RAG_CHUNKS = 4;
const MAX_DEXTER_RAG_CHUNKS = 6;
const MAX_QUERY_CHARS = 700;
const MAX_SNIPPET_CHARS = 700;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_SAFETY: KnowledgeRetrievalSafetySummary = {
  trustBoundary: "tenant_uploaded_untrusted",
  riskLevel: "none",
  flags: [],
  hasUnsafeCitations: false,
  excludedUnsafeCitationCount: 0
};

type PromptSafetyTelemetry = ReturnType<typeof promptSafetyTelemetry>;

export type DexterRagContextStatus = "attached" | "empty" | "denied" | "degraded";

export type DexterRagSnippet = {
  citationId: string;
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  title: string;
  documentKind: string;
  folderId: string | null;
  folderName: string | null;
  versionNumber: number;
  chunkIndex: number;
  sourceLocator: string | null;
  originalFilename: string;
  score: number;
  text: string;
  safety: KnowledgeRetrievalCitation["safety"];
};

export type DexterRagContext = {
  schema: typeof DEXTER_RAG_SCHEMA;
  status: DexterRagContextStatus;
  trustBoundary: "tenant_uploaded_untrusted_context";
  authority: {
    snippetsArePolicy: false;
    canGrantPermissions: false;
    canOverrideSystemPolicy: false;
    requiresCitation: true;
  };
  retrieval: {
    purpose: typeof DEXTER_RAG_QUERY_PURPOSE;
    triggerEventType: string;
    querySource: "event_excerpt" | "event_payload" | "none";
    maxChunks: number;
    publishedOnly: true;
    aiVisibleOnly: true;
    excludeUnsafeContent: true;
    resourceType: string | null;
    resourceId: string | null;
    runId: string | null;
  };
  outcome: KnowledgeRetrievalOutcome | "not_requested" | "error";
  confidence: number;
  snippets: DexterRagSnippet[];
  safety: KnowledgeRetrievalSafetySummary;
  promptSafety: PromptSafetyTelemetry | null;
  warning: string | null;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readUuid(value: unknown) {
  const text = readString(value);
  return text && UUID_RE.test(text) ? text : null;
}

function normalizeText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 3)}...` : normalized;
}

function normalizeLimit(limit: number | null | undefined) {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_MAX_DEXTER_RAG_CHUNKS;
  return Math.min(Math.max(Math.floor(limit as number), 1), MAX_DEXTER_RAG_CHUNKS);
}

function collectPayloadText(payload: Record<string, unknown>) {
  const values = [
    readString(payload.excerpt),
    readString(payload.summary),
    readString(payload.subject),
    readString(payload.title),
    readString(payload.text),
    readString(payload.body),
    readString(payload.previewText),
    readString(payload.preview_text)
  ].filter((value): value is string => Boolean(value));

  const nestedKeys = ["message", "email", "whatsapp", "call", "ticket"];
  for (const key of nestedKeys) {
    const nested = readRecord(payload[key]);
    if (!nested) continue;
    values.push(
      ...[
        readString(nested.excerpt),
        readString(nested.summary),
        readString(nested.subject),
        readString(nested.text),
        readString(nested.body),
        readString(nested.transcriptExcerpt),
        readString(nested.transcriptSummary),
        readString(nested.previewText),
        readString(nested.preview_text)
      ].filter((value): value is string => Boolean(value))
    );
  }

  const deduped = Array.from(new Set(values.map((value) => normalizeText(value, MAX_QUERY_CHARS))))
    .filter(Boolean)
    .slice(0, 3);
  return deduped.join(" ");
}

function resolveQuery(payload: Record<string, unknown>) {
  const excerpt = readString(payload.excerpt);
  if (excerpt) {
    return {
      text: normalizeText(excerpt, MAX_QUERY_CHARS),
      source: "event_excerpt" as const
    };
  }

  const text = collectPayloadText(payload);
  return {
    text: normalizeText(text, MAX_QUERY_CHARS),
    source: text ? ("event_payload" as const) : ("none" as const)
  };
}

function resolveResource(payload: Record<string, unknown>) {
  const resource = readRecord(payload.resource);
  const source = resource ?? payload;
  const explicitType = readString(source.resourceType) ?? readString(source.resource_type);
  const explicitId = readUuid(source.resourceId) ?? readUuid(source.resource_id);
  if (explicitType && explicitId) {
    return { resourceType: explicitType.slice(0, 80), resourceId: explicitId };
  }

  const candidates: Array<[string, unknown]> = [
    ["ticket", source.ticket_id ?? source.ticketId],
    ["message", source.message_id ?? source.messageId],
    ["customer", source.customer_id ?? source.customerId],
    ["call", source.call_id ?? source.callId],
    ["thread", source.thread_id ?? source.threadId]
  ];
  for (const [resourceType, value] of candidates) {
    const resourceId = readUuid(value);
    if (resourceId) return { resourceType, resourceId };
  }
  return {
    resourceType: explicitType?.slice(0, 80) ?? null,
    resourceId: null
  };
}

function baseContext({
  status,
  outcome,
  eventType,
  querySource,
  maxChunks,
  resourceType,
  resourceId,
  runId,
  confidence = 0,
  snippets = [],
  safety = EMPTY_SAFETY,
  promptSafety = null,
  warning = null
}: {
  status: DexterRagContextStatus;
  outcome: DexterRagContext["outcome"];
  eventType: string;
  querySource: DexterRagContext["retrieval"]["querySource"];
  maxChunks: number;
  resourceType: string | null;
  resourceId: string | null;
  runId: string | null;
  confidence?: number;
  snippets?: DexterRagSnippet[];
  safety?: KnowledgeRetrievalSafetySummary;
  promptSafety?: PromptSafetyTelemetry | null;
  warning?: string | null;
}): DexterRagContext {
  return {
    schema: DEXTER_RAG_SCHEMA,
    status,
    trustBoundary: "tenant_uploaded_untrusted_context",
    authority: {
      snippetsArePolicy: false,
      canGrantPermissions: false,
      canOverrideSystemPolicy: false,
      requiresCitation: true
    },
    retrieval: {
      purpose: DEXTER_RAG_QUERY_PURPOSE,
      triggerEventType: eventType,
      querySource,
      maxChunks,
      publishedOnly: true,
      aiVisibleOnly: true,
      excludeUnsafeContent: true,
      resourceType,
      resourceId,
      runId
    },
    outcome,
    confidence,
    snippets,
    safety,
    promptSafety,
    warning
  };
}

function toSnippet(citation: KnowledgeRetrievalCitation, index: number): DexterRagSnippet {
  return {
    citationId: `rag-citation-${index + 1}`,
    chunkId: citation.chunkId,
    documentId: citation.documentId,
    documentVersionId: citation.documentVersionId,
    title: citation.title,
    documentKind: citation.documentKind,
    folderId: citation.folderId,
    folderName: citation.folderName,
    versionNumber: citation.versionNumber,
    chunkIndex: citation.chunkIndex,
    sourceLocator: citation.sourceLocator,
    originalFilename: citation.originalFilename,
    score: citation.score,
    text: normalizeText(citation.snippet, MAX_SNIPPET_CHARS),
    safety: citation.safety
  };
}

export async function buildDexterRagContextForEvent({
  tenantId,
  runId,
  eventType,
  payload,
  limit
}: {
  tenantId: string;
  runId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  limit?: number | null;
}) {
  const maxChunks = normalizeLimit(limit);
  const query = resolveQuery(payload);
  const resource = resolveResource(payload);

  if (query.text.length < 2) {
    return baseContext({
      status: "empty",
      outcome: "not_requested",
      eventType,
      querySource: query.source,
      maxChunks,
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      runId
    });
  }

  const result = await retrievePublishedKnowledge({
    tenantId,
    runId,
    query: query.text,
    queryPurpose: DEXTER_RAG_QUERY_PURPOSE,
    limit: maxChunks,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    outcome: "proposed_action",
    excludeUnsafeContent: true,
    enforcePromptSafety: true
  });
  const snippets = result.citations.map(toSnippet);
  const status =
    result.outcome === "denied" ? "denied" : snippets.length > 0 ? "attached" : "empty";

  return baseContext({
    status,
    outcome: result.outcome,
    eventType,
    querySource: query.source,
    maxChunks,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    runId,
    confidence: result.confidence,
    snippets,
    safety: result.safety,
    promptSafety: promptSafetyTelemetry(result.promptSafety as PromptSafetyDecision),
    warning:
      status === "denied"
        ? "Runtime knowledge retrieval was denied by prompt-safety or knowledge-safety policy."
        : null
  });
}

export function buildDegradedDexterRagContext({
  runId,
  eventType = "agent.event",
  payload,
  error
}: {
  runId: string | null;
  eventType?: string;
  payload: Record<string, unknown>;
  error: unknown;
}) {
  const query = resolveQuery(payload);
  const resource = resolveResource(payload);
  const message = error instanceof Error ? error.message : String(error);
  return baseContext({
    status: "degraded",
    outcome: "error",
    eventType,
    querySource: query.source,
    maxChunks: DEFAULT_MAX_DEXTER_RAG_CHUNKS,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    runId,
    warning: `Runtime knowledge retrieval unavailable: ${message.slice(0, 180)}`
  });
}

export function attachDexterRagContextToPayload(
  payload: Record<string, unknown>,
  context: DexterRagContext
) {
  const metadata = readRecord(payload.metadata);
  return {
    ...payload,
    dexterRagContext: context,
    metadata: {
      ...(metadata ?? {}),
      dexterRagContext: {
        schema: context.schema,
        status: context.status,
        outcome: context.outcome,
        snippetCount: context.snippets.length,
        citationIds: context.snippets.map((snippet) => snippet.citationId),
        confidence: context.confidence,
        trustBoundary: context.trustBoundary,
        authority: context.authority,
        safety: context.safety
      }
    }
  };
}

export function summarizeDexterRagContextForLedger(context: DexterRagContext) {
  return {
    schema: context.schema,
    status: context.status,
    outcome: context.outcome,
    confidence: context.confidence,
    snippetCount: context.snippets.length,
    citations: context.snippets.map((snippet) => ({
      citationId: snippet.citationId,
      chunkId: snippet.chunkId,
      documentVersionId: snippet.documentVersionId,
      title: snippet.title,
      score: snippet.score,
      safety: snippet.safety
    })),
    safety: context.safety,
    promptSafety: context.promptSafety
      ? {
          decision: context.promptSafety.decision,
          riskLevel: context.promptSafety.riskLevel,
          flags: context.promptSafety.flags,
          toolPolicy: context.promptSafety.toolPolicy
        }
      : null,
    retrieval: context.retrieval,
    authority: context.authority,
    warning: context.warning
  };
}
