import { db } from "@/server/db";

export type AgentDraft = {
  id: string;
  integration_id: string | null;
  ticket_id: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  confidence: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export async function listDraftsForTicket(ticketId: string) {
  const result = await db.query<AgentDraft>(
    `SELECT id, integration_id, ticket_id, subject, body_text, body_html, confidence,
            status, created_at, updated_at
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
  confidence
}: {
  integrationId: string;
  ticketId: string;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  confidence?: number | null;
}) {
  const result = await db.query<AgentDraft>(
    `INSERT INTO agent_drafts (integration_id, ticket_id, subject, body_text, body_html, confidence)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, integration_id, ticket_id, subject, body_text, body_html,
               confidence, status, created_at, updated_at`,
    [
      integrationId,
      ticketId,
      subject ?? null,
      bodyText ?? null,
      bodyHtml ?? null,
      confidence ?? null
    ]
  );
  return result.rows[0];
}
