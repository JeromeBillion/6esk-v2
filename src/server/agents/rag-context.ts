import { retrieveKnowledge, type KnowledgeRetrievalResult } from "@/server/ai/knowledge-base";

export type AgentKnowledgeContext = {
  source: "ai_knowledge_base";
  query: string;
  results: Array<{
    document_id: string;
    chunk_id: string;
    title: string | null;
    filename: string;
    content: string;
    score: number;
  }>;
};

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function buildAgentKnowledgeQuery(input: {
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const direct =
    readString(input.payload.excerpt) ??
    readString(input.payload.summary) ??
    readString(input.payload.subject);
  if (direct) return direct.slice(0, 500);

  const resource = asRecord(input.payload.resource);
  const ticketId = readString(resource?.ticket_id);
  const mailboxId = readString(resource?.mailbox_id);
  const conversationRef = readString(input.payload.conversation_ref);
  const fallbackParts = [input.eventType, ticketId, mailboxId, conversationRef].filter(Boolean);
  return fallbackParts.length >= 2 ? fallbackParts.join(" ") : null;
}

function toContextResult(result: KnowledgeRetrievalResult) {
  return {
    document_id: result.documentId,
    chunk_id: result.chunkId,
    title: result.title,
    filename: result.filename,
    content: result.content.slice(0, 1200),
    score: result.score
  };
}

export async function buildAgentKnowledgeContext(input: {
  tenantKey: string;
  workspaceKey?: string | null;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<AgentKnowledgeContext | null> {
  const query = buildAgentKnowledgeQuery({
    eventType: input.eventType,
    payload: input.payload
  });
  if (!query) {
    return null;
  }

  try {
    const results = await retrieveKnowledge({
      tenantKey: input.tenantKey,
      workspaceKey: input.workspaceKey ?? "primary",
      query,
      limit: 3,
      metadata: {
        source: "agent_outbox",
        eventType: input.eventType
      }
    });
    if (!results.length) {
      return null;
    }
    return {
      source: "ai_knowledge_base",
      query,
      results: results.map(toContextResult)
    };
  } catch {
    return null;
  }
}
