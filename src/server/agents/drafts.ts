import { db } from "@/server/db";

export type AgentDraft = {
  id: string;
  integration_id: string | null;
  ticket_id: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  confidence: number | null;
  metadata: Record<string, unknown> | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type DraftStatus = "pending" | "used" | "dismissed";

export async function getDraftById({
  draftId,
  ticketId
}: {
  draftId: string;
  ticketId: string;
}) {
  const result = await db.query<AgentDraft>(
    `SELECT id, integration_id, ticket_id, subject, body_text, body_html, confidence,
            metadata, status, created_at, updated_at
     FROM agent_drafts
     WHERE id = $1 AND ticket_id = $2
     LIMIT 1`,
    [draftId, ticketId]
  );
  return result.rows[0] ?? null;
}

export async function listDraftsForTicket(ticketId: string) {
  const result = await db.query<AgentDraft>(
    `SELECT id, integration_id, ticket_id, subject, body_text, body_html, confidence,
            metadata, status, created_at, updated_at
     FROM agent_drafts
     WHERE ticket_id = $1
       AND status = 'pending'
     ORDER BY created_at DESC`,
    [ticketId]
  );
  return result.rows;
}

export async function createDraft({
  integrationId,
  ticketId,
  subject,
  bodyText,
  bodyHtml,
  confidence,
  metadata
}: {
  integrationId: string;
  ticketId: string;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  const result = await db.query<AgentDraft>(
    `INSERT INTO agent_drafts (integration_id, ticket_id, subject, body_text, body_html, confidence, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, integration_id, ticket_id, subject, body_text, body_html,
               confidence, metadata, status, created_at, updated_at`,
    [
      integrationId,
      ticketId,
      subject ?? null,
      bodyText ?? null,
      bodyHtml ?? null,
      confidence ?? null,
      metadata ?? null
    ]
  );
  return result.rows[0];
}

export async function updateDraftStatus({
  draftId,
  ticketId,
  status
}: {
  draftId: string;
  ticketId: string;
  status: DraftStatus;
}) {
  const result = await db.query<AgentDraft>(
    `UPDATE agent_drafts
     SET status = $1, updated_at = now()
     WHERE id = $2 AND ticket_id = $3 AND status = 'pending'
     RETURNING id, integration_id, ticket_id, subject, body_text, body_html,
               confidence, metadata, status, created_at, updated_at`,
    [status, draftId, ticketId]
  );
  return result.rows[0] ?? null;
}

export async function updateDraftContent({
  draftId,
  ticketId,
  subject,
  bodyText,
  bodyHtml
}: {
  draftId: string;
  ticketId: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
}) {
  const result = await db.query<AgentDraft>(
    `UPDATE agent_drafts
     SET subject = $1,
         body_text = $2,
         body_html = $3,
         updated_at = now()
     WHERE id = $4 AND ticket_id = $5 AND status = 'pending'
     RETURNING id, integration_id, ticket_id, subject, body_text, body_html,
               confidence, metadata, status, created_at, updated_at`,
    [subject, bodyText, bodyHtml, draftId, ticketId]
  );
  return result.rows[0] ?? null;
}
