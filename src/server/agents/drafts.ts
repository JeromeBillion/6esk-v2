import { db } from "@/server/db";
import { LEAD_ADMIN_ROLE } from "@/server/auth/roles";
import type { SessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";

export type AgentDraft = {
  id: string;
  tenant_id?: string;
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

export type DraftQueueItem = AgentDraft & {
  ticket_subject: string | null;
  requester_email: string;
  ticket_status: string;
  ticket_priority: string;
  assigned_user_id: string | null;
  has_whatsapp: boolean;
  has_voice: boolean;
};

function normalizeTenantId(tenantId: string | null | undefined) {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function requireTenantId(tenantId: string | null | undefined, operation: string) {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) {
    throw new Error(`${operation} requires tenantId`);
  }
  return normalized;
}

export async function getDraftById({
  draftId,
  ticketId,
  tenantId
}: {
  draftId: string;
  ticketId: string;
  tenantId?: string | null;
}) {
  const scopedTenantId = normalizeTenantId(tenantId);
  if (!scopedTenantId) {
    return null;
  }

  const result = await db.query<AgentDraft>(
    `SELECT id, tenant_id, integration_id, ticket_id, subject, body_text, body_html, confidence,
            metadata, status, created_at, updated_at
     FROM agent_drafts
     WHERE id = $1 AND ticket_id = $2
       AND tenant_id = $3
     LIMIT 1`,
    [draftId, ticketId, scopedTenantId]
  );
  return result.rows[0] ?? null;
}

export async function listDraftsForTicket(ticketId: string, tenantId?: string | null) {
  const scopedTenantId = normalizeTenantId(tenantId);
  if (!scopedTenantId) {
    return [];
  }

  const result = await db.query<AgentDraft>(
    `SELECT id, tenant_id, integration_id, ticket_id, subject, body_text, body_html, confidence,
            metadata, status, created_at, updated_at
     FROM agent_drafts
     WHERE ticket_id = $1
       AND tenant_id = $2
       AND status = 'pending'
     ORDER BY created_at DESC`,
    [ticketId, scopedTenantId]
  );
  return result.rows;
}

export async function listPendingDraftsForUser(
  user: SessionUser,
  filters?: {
    search?: string | null;
    channel?: string | null;
    assignedUserId?: string | null;
  }
) {
  const values: Array<string> = [];
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return [];
  }
  const conditions: string[] = ["d.status = 'pending'"];
  values.push(tenantId);
  conditions.push(`d.tenant_id = $${values.length}`);
  conditions.push("t.tenant_id = d.tenant_id");

  const isAdmin = user.role_name === LEAD_ADMIN_ROLE;
  if (!isAdmin) {
    values.push(user.id);
    conditions.push(`t.assigned_user_id = $${values.length}`);
  } else if (filters?.assignedUserId) {
    values.push(filters.assignedUserId);
    conditions.push(`t.assigned_user_id = $${values.length}`);
  }

  if (filters?.search) {
    values.push(`%${filters.search}%`);
    conditions.push(
      `(t.subject ILIKE $${values.length} OR t.requester_email ILIKE $${values.length} OR d.body_text ILIKE $${values.length})`
    );
  }

  if (filters?.channel) {
    const channel = filters.channel.toLowerCase();
    if (channel === "whatsapp") {
      values.push("whatsapp");
      const placeholder = `$${values.length}`;
      values.push("whatsapp:%");
      const requesterPlaceholder = `$${values.length}`;
      conditions.push(
        `(
          EXISTS (
            SELECT 1
            FROM messages channel_msg
            WHERE channel_msg.ticket_id = t.id
              AND channel_msg.tenant_id = d.tenant_id
              AND channel_msg.channel = ${placeholder}
          )
          OR t.requester_email ILIKE ${requesterPlaceholder}
        )`
      );
    }
    if (channel === "voice") {
      values.push("voice");
      const placeholder = `$${values.length}`;
      values.push("voice:%");
      const requesterPlaceholder = `$${values.length}`;
      conditions.push(
        `(
          EXISTS (
            SELECT 1
            FROM messages channel_msg
            WHERE channel_msg.ticket_id = t.id
              AND channel_msg.tenant_id = d.tenant_id
              AND channel_msg.channel = ${placeholder}
          )
          OR t.requester_email ILIKE ${requesterPlaceholder}
        )`
      );
    }
    if (channel === "email") {
      values.push("whatsapp");
      const whatsappPlaceholder = `$${values.length}`;
      values.push("voice");
      const voicePlaceholder = `$${values.length}`;
      values.push("whatsapp:%");
      const whatsappRequesterPlaceholder = `$${values.length}`;
      values.push("voice:%");
      const voiceRequesterPlaceholder = `$${values.length}`;
      conditions.push(
        `NOT EXISTS (
          SELECT 1
          FROM messages channel_msg
          WHERE channel_msg.ticket_id = t.id
            AND channel_msg.tenant_id = d.tenant_id
            AND channel_msg.channel = ${whatsappPlaceholder}
        )`
      );
      conditions.push(
        `NOT EXISTS (
          SELECT 1
          FROM messages channel_msg
          WHERE channel_msg.ticket_id = t.id
            AND channel_msg.tenant_id = d.tenant_id
            AND channel_msg.channel = ${voicePlaceholder}
        )`
      );
      conditions.push(`t.requester_email NOT ILIKE ${whatsappRequesterPlaceholder}`);
      conditions.push(`t.requester_email NOT ILIKE ${voiceRequesterPlaceholder}`);
    }
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.query<DraftQueueItem>(
    `SELECT d.id, d.integration_id, d.ticket_id, d.subject, d.body_text, d.body_html, d.confidence,
            d.metadata, d.status, d.created_at, d.updated_at,
            t.subject AS ticket_subject,
            t.requester_email,
            t.status AS ticket_status,
            t.priority AS ticket_priority,
            t.assigned_user_id,
            EXISTS (
              SELECT 1 FROM messages msg
              WHERE msg.ticket_id = t.id AND msg.tenant_id = d.tenant_id AND msg.channel = 'whatsapp'
            ) OR t.requester_email ILIKE 'whatsapp:%' AS has_whatsapp,
            EXISTS (
              SELECT 1 FROM messages msg
              WHERE msg.ticket_id = t.id AND msg.tenant_id = d.tenant_id AND msg.channel = 'voice'
            ) OR t.requester_email ILIKE 'voice:%' AS has_voice
     FROM agent_drafts d
     JOIN tickets t ON t.id = d.ticket_id
     ${whereClause}
     ORDER BY d.created_at DESC
     LIMIT 200`,
    values
  );

  return result.rows;
}

export async function createDraft({
  tenantId,
  integrationId,
  ticketId,
  subject,
  bodyText,
  bodyHtml,
  confidence,
  metadata
}: {
  tenantId?: string | null;
  integrationId: string;
  ticketId: string;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  const scopedTenantId = requireTenantId(tenantId, "Create agent draft");
  const result = await db.query<AgentDraft>(
    `INSERT INTO agent_drafts (tenant_id, integration_id, ticket_id, subject, body_text, body_html, confidence, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, tenant_id, integration_id, ticket_id, subject, body_text, body_html,
               confidence, metadata, status, created_at, updated_at`,
    [
      scopedTenantId,
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
  status,
  tenantId
}: {
  draftId: string;
  ticketId: string;
  status: DraftStatus;
  tenantId?: string | null;
}) {
  const scopedTenantId = normalizeTenantId(tenantId);
  if (!scopedTenantId) {
    return null;
  }

  const result = await db.query<AgentDraft>(
    `UPDATE agent_drafts
     SET status = $1, updated_at = now()
     WHERE id = $2 AND ticket_id = $3
       AND tenant_id = $4
       AND status = 'pending'
     RETURNING id, tenant_id, integration_id, ticket_id, subject, body_text, body_html,
               confidence, metadata, status, created_at, updated_at`,
    [status, draftId, ticketId, scopedTenantId]
  );
  return result.rows[0] ?? null;
}

export async function updateDraftContent({
  draftId,
  ticketId,
  subject,
  bodyText,
  bodyHtml,
  tenantId
}: {
  draftId: string;
  ticketId: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  tenantId?: string | null;
}) {
  const scopedTenantId = normalizeTenantId(tenantId);
  if (!scopedTenantId) {
    return null;
  }

  const result = await db.query<AgentDraft>(
    `UPDATE agent_drafts
     SET subject = $1,
         body_text = $2,
         body_html = $3,
         updated_at = now()
     WHERE id = $4 AND ticket_id = $5 AND tenant_id = $6 AND status = 'pending'
     RETURNING id, tenant_id, integration_id, ticket_id, subject, body_text, body_html,
               confidence, metadata, status, created_at, updated_at`,
    [subject, bodyText, bodyHtml, draftId, ticketId, scopedTenantId]
  );
  return result.rows[0] ?? null;
}
