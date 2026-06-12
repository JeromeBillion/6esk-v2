import { db } from "@/server/db";
import {
  isHighRiskKnowledgeSafety,
  normalizeKnowledgeSafety,
  summarizeKnowledgeRetrievalSafety,
  type KnowledgeCitationSafety,
  type KnowledgeRetrievalSafetySummary
} from "@/server/ai/knowledge-safety";
import {
  evaluatePromptSafety,
  isPromptDenied,
  promptSafetyTelemetry
} from "@/server/ai/prompt-safety";

const DEFAULT_RETRIEVAL_LIMIT = 6;
const MAX_RETRIEVAL_LIMIT = 12;
const MAX_SEARCH_CANDIDATES = MAX_RETRIEVAL_LIMIT * 3;

export type KnowledgeRetrievalOutcome =
  | "answered"
  | "drafted"
  | "proposed_action"
  | "autonomous_action"
  | "no_answer"
  | "denied"
  | "error";

export type KnowledgeRetrievalCitation = {
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
  snippet: string;
  safety: KnowledgeCitationSafety;
};

type RetrievalRow = {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  title: string;
  document_kind: string;
  folder_id: string | null;
  folder_name: string | null;
  version_number: number;
  chunk_index: number;
  source_locator: string | null;
  original_filename: string;
  score: number | string | null;
  snippet: string;
  metadata: unknown;
};

function normalizeQuery(query: string) {
  return query.replace(/\s+/g, " ").trim().slice(0, 500);
}

function normalizeFolderIds(folderIds: readonly string[] | null | undefined) {
  return Array.from(new Set((folderIds ?? []).map((id) => id.trim()).filter(Boolean))).slice(0, 50);
}

function normalizeLimit(limit: number | null | undefined) {
  if (!Number.isFinite(limit ?? NaN)) return DEFAULT_RETRIEVAL_LIMIT;
  return Math.min(Math.max(Math.floor(limit as number), 1), MAX_RETRIEVAL_LIMIT);
}

function scoreToNumber(score: number | string | null | undefined) {
  const value = Number(score ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function toCitation(row: RetrievalRow): KnowledgeRetrievalCitation {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentVersionId: row.document_version_id,
    title: row.title,
    documentKind: row.document_kind,
    folderId: row.folder_id,
    folderName: row.folder_name,
    versionNumber: Number(row.version_number),
    chunkIndex: Number(row.chunk_index),
    sourceLocator: row.source_locator,
    originalFilename: row.original_filename,
    score: scoreToNumber(row.score),
    snippet: row.snippet,
    safety: normalizeKnowledgeSafety(row.metadata)
  };
}

export async function retrievePublishedKnowledge({
  tenantId,
  actorUserId,
  query,
  queryPurpose = "admin_test",
  folderIds,
  limit,
  runId,
  resourceType,
  resourceId,
  outcome = "answered",
  excludeUnsafeContent = false,
  enforcePromptSafety
}: {
  tenantId: string;
  actorUserId?: string | null;
  query: string;
  queryPurpose?: string;
  folderIds?: string[] | null;
  limit?: number | null;
  runId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome?: KnowledgeRetrievalOutcome;
  excludeUnsafeContent?: boolean;
  enforcePromptSafety?: boolean;
}) {
  const normalizedQuery = normalizeQuery(query);
  const shouldEnforcePromptSafety = enforcePromptSafety ?? excludeUnsafeContent;
  const promptSafety = evaluatePromptSafety({
    text: normalizedQuery,
    source: queryPurpose,
    maxLength: 500
  });
  const promptSafetySummary = promptSafetyTelemetry(promptSafety);
  const retrievalQuery = shouldEnforcePromptSafety ? promptSafety.normalizedText : normalizedQuery;
  const retrievalQuerySummary = shouldEnforcePromptSafety
    ? promptSafetySummary.contentSample
    : retrievalQuery;
  const effectiveExcludeUnsafeContent =
    excludeUnsafeContent ||
    (shouldEnforcePromptSafety && promptSafety.toolPolicy.forceKnowledgeSafetyFilter);
  const normalizedFolderIds = normalizeFolderIds(folderIds);
  const normalizedLimit = normalizeLimit(limit);
  const candidateLimit = effectiveExcludeUnsafeContent
    ? Math.min(normalizedLimit * 3, MAX_SEARCH_CANDIDATES)
    : normalizedLimit;

  if (shouldEnforcePromptSafety && isPromptDenied(promptSafety)) {
    const safety = summarizeKnowledgeRetrievalSafety([]);
    const denied = {
      query: retrievalQuery,
      citations: [] as KnowledgeRetrievalCitation[],
      confidence: 0,
      outcome: "denied" as const,
      safety,
      promptSafety
    };
    await recordKnowledgeRetrievalEvent({
      tenantId,
      actorUserId,
      runId,
      resourceType,
      resourceId,
      queryPurpose,
      querySummary: retrievalQuerySummary,
      filters: {
        folderIds: normalizedFolderIds,
        limit: normalizedLimit,
        publishedOnly: true,
        aiVisibleOnly: true,
        excludeUnsafeContent: effectiveExcludeUnsafeContent,
        enforcePromptSafety: shouldEnforcePromptSafety
      },
      citations: denied.citations,
      confidence: denied.confidence,
      outcome: denied.outcome,
      usageMetadata: { safety, promptSafety: promptSafetySummary }
    });
    return denied;
  }

  if (retrievalQuery.length < 2) {
    const safety = summarizeKnowledgeRetrievalSafety([]);
    const empty = {
      query: retrievalQuery,
      citations: [] as KnowledgeRetrievalCitation[],
      confidence: 0,
      outcome: "no_answer" as const,
      safety,
      promptSafety
    };
    await recordKnowledgeRetrievalEvent({
      tenantId,
      actorUserId,
      runId,
      resourceType,
      resourceId,
      queryPurpose,
      querySummary: retrievalQuerySummary,
      filters: {
        folderIds: normalizedFolderIds,
        limit: normalizedLimit,
        publishedOnly: true,
        aiVisibleOnly: true,
        excludeUnsafeContent: effectiveExcludeUnsafeContent,
        enforcePromptSafety: shouldEnforcePromptSafety
      },
      citations: empty.citations,
      confidence: empty.confidence,
      outcome: empty.outcome,
      usageMetadata: { safety, promptSafety: promptSafetySummary }
    });
    return empty;
  }

  const result = await db.query<RetrievalRow>(
    `WITH query AS (
       SELECT websearch_to_tsquery('simple', $2) AS tsq,
              lower($2) AS raw_query
     )
     SELECT c.id AS chunk_id,
            d.id AS document_id,
            v.id AS document_version_id,
            d.title,
            d.document_kind,
            d.folder_id,
            f.name AS folder_name,
            v.version_number,
            c.chunk_index,
            c.source_locator,
            v.original_filename,
            ts_rank_cd(to_tsvector('simple', c.content_text), query.tsq)::float AS score,
            left(c.content_text, 1200) AS snippet,
            c.metadata
     FROM knowledge_chunks c
     JOIN knowledge_document_versions v
       ON v.tenant_id = c.tenant_id
      AND v.id = c.document_version_id
      AND v.status = 'published'
      AND v.deleted_at IS NULL
     JOIN knowledge_documents d
       ON d.tenant_id = c.tenant_id
      AND d.id = v.document_id
      AND d.status = 'published'
      AND d.deleted_at IS NULL
     LEFT JOIN knowledge_folders f
       ON f.tenant_id = d.tenant_id
      AND f.id = d.folder_id
      AND f.archived_at IS NULL
     CROSS JOIN query
     WHERE c.tenant_id = $1
       AND (d.folder_id IS NULL OR f.visibility = 'ai_visible')
       AND (
         cardinality($3::uuid[]) = 0
         OR d.folder_id = ANY($3::uuid[])
       )
       AND (
         to_tsvector('simple', c.content_text) @@ query.tsq
         OR lower(c.content_text) LIKE ('%' || query.raw_query || '%')
       )
     ORDER BY score DESC, v.published_at DESC NULLS LAST, d.updated_at DESC, c.chunk_index ASC
     LIMIT $4`,
    [tenantId, retrievalQuery, normalizedFolderIds, candidateLimit]
  );

  const candidateCitations = result.rows.map(toCitation);
  const excludedUnsafeCitationCount = effectiveExcludeUnsafeContent
    ? candidateCitations.filter((citation) => isHighRiskKnowledgeSafety(citation.safety)).length
    : 0;
  const citations = (effectiveExcludeUnsafeContent
    ? candidateCitations.filter((citation) => !isHighRiskKnowledgeSafety(citation.safety))
    : candidateCitations
  ).slice(0, normalizedLimit);
  const confidence = citations.length ? Math.max(...citations.map((citation) => citation.score)) : 0;
  const resolvedOutcome = citations.length
    ? outcome
    : excludedUnsafeCitationCount > 0
      ? "denied"
      : "no_answer";
  const safety = summarizeKnowledgeRetrievalSafety(citations, excludedUnsafeCitationCount);

  await recordKnowledgeRetrievalEvent({
    tenantId,
    actorUserId,
    runId,
    resourceType,
    resourceId,
    queryPurpose,
    querySummary: retrievalQuerySummary,
    filters: {
      folderIds: normalizedFolderIds,
      limit: normalizedLimit,
      publishedOnly: true,
      aiVisibleOnly: true,
      excludeUnsafeContent: effectiveExcludeUnsafeContent,
      enforcePromptSafety: shouldEnforcePromptSafety
    },
    citations,
    confidence,
    outcome: resolvedOutcome,
    usageMetadata: {
      safety,
      promptSafety: promptSafetySummary,
      candidateCitationCount: candidateCitations.length
    }
  });

  return {
    query: retrievalQuery,
    citations,
    confidence,
    outcome: resolvedOutcome,
    safety,
    promptSafety
  };
}

export async function recordKnowledgeRetrievalEvent({
  tenantId,
  actorUserId,
  runId,
  resourceType,
  resourceId,
  queryPurpose,
  querySummary,
  filters,
  citations,
  confidence,
  outcome,
  usageMetadata
}: {
  tenantId: string;
  actorUserId?: string | null;
  runId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  queryPurpose: string;
  querySummary?: string | null;
  filters?: Record<string, unknown>;
  citations: KnowledgeRetrievalCitation[];
  confidence: number;
  outcome: KnowledgeRetrievalOutcome;
  usageMetadata?: Record<string, unknown>;
}) {
  await db.query(
    `INSERT INTO knowledge_retrieval_events (
       tenant_id, actor_user_id, run_id, resource_type, resource_id,
       query_purpose, query_summary, filters, result_document_version_ids,
       result_chunk_ids, scores, confidence, outcome, usage_metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::uuid[], $10::uuid[], $11::jsonb, $12, $13, $14::jsonb)`,
    [
      tenantId,
      actorUserId ?? null,
      runId ?? null,
      resourceType ?? null,
      resourceId ?? null,
      queryPurpose,
      querySummary ?? null,
      JSON.stringify(filters ?? {}),
      citations.map((citation) => citation.documentVersionId),
      citations.map((citation) => citation.chunkId),
      JSON.stringify(
        citations.map((citation) => ({
          chunkId: citation.chunkId,
          documentVersionId: citation.documentVersionId,
          score: citation.score
        }))
      ),
      confidence,
      outcome,
      JSON.stringify(usageMetadata ?? {})
    ]
  );
}
