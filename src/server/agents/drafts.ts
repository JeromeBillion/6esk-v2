import { db } from "@/server/db";
import { LEAD_ADMIN_ROLE } from "@/server/auth/roles";
import type { SessionUser } from "@/server/auth/session";
import { resolveTenantScope, tenantScopeFromUser, type TenantScopeInput } from "@/server/tenant-context";

export type AgentDraft = {
  id: string;
  tenant_key: string;
  workspace_key: string;
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

export async function getDraftById({
  draftId,
  ticketId,
  tenantKey,
  workspaceKey
}: {
  draftId: string;
  ticketId: string;
  tenantKey?: string | null;
  workspaceKey?: string | null;
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  const result = await db.query<AgentDraft>(
    `SELECT d.id, d.tenant_key, d.workspace_key, d.integration_id, d.ticket_id,
            d.subject, d.body_text, d.body_html, d.confidence,
            d.metadata, d.status, d.created_at, d.updated_at
     FROM agent_drafts d
     JOIN tickets t
       ON t.id = d.ticket_id
      AND t.tenant_key = d.tenant_key
      AND t.workspace_key = d.workspace_key
     WHERE d.id = $1
       AND d.ticket_id = $2
       AND d.tenant_key = $3
       AND d.workspace_key = $4
     LIMIT 1`,
    [draftId, ticketId, scope.tenantKey, scope.workspaceKey]
  );
  return result.rows[0] ?? null;
}

export async function listDraftsForTicket(ticketId: string, scopeInput?: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
  const result = await db.query<AgentDraft>(
    `SELECT d.id, d.tenant_key, d.workspace_key, d.integration_id, d.ticket_id,
            d.subject, d.body_text, d.body_html, d.confidence,
            d.metadata, d.status, d.created_at, d.updated_at
     FROM agent_drafts d
     JOIN tickets t
       ON t.id = d.ticket_id
      AND t.tenant_key = d.tenant_key
      AND t.workspace_key = d.workspace_key
     WHERE d.ticket_id = $1
       AND d.status = 'pending'
       AND d.tenant_key = $2
       AND d.workspace_key = $3
     ORDER BY d.created_at DESC`,
    [ticketId, scope.tenantKey, scope.workspaceKey]
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
  const scope = tenantScopeFromUser(user);
  const values: Array<string> = [scope.tenantKey, scope.workspaceKey];
  const conditions: string[] = [
    "d.status = 'pending'",
    "d.tenant_key = $1",
    "d.workspace_key = $2"
  ];

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
              AND channel_msg.tenant_key = t.tenant_key
              AND channel_msg.workspace_key = t.workspace_key
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
              AND channel_msg.tenant_key = t.tenant_key
              AND channel_msg.workspace_key = t.workspace_key
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
            AND channel_msg.tenant_key = t.tenant_key
            AND channel_msg.workspace_key = t.workspace_key
            AND channel_msg.channel = ${whatsappPlaceholder}
        )`
      );
      conditions.push(
        `NOT EXISTS (
          SELECT 1
          FROM messages channel_msg
          WHERE channel_msg.ticket_id = t.id
            AND channel_msg.tenant_key = t.tenant_key
            AND channel_msg.workspace_key = t.workspace_key
            AND channel_msg.channel = ${voicePlaceholder}
        )`
      );
      conditions.push(`t.requester_email NOT ILIKE ${whatsappRequesterPlaceholder}`);
      conditions.push(`t.requester_email NOT ILIKE ${voiceRequesterPlaceholder}`);
    }
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await db.query<DraftQueueItem>(
    `SELECT d.id, d.tenant_key, d.workspace_key, d.integration_id, d.ticket_id,
            d.subject, d.body_text, d.body_html, d.confidence,
            d.metadata, d.status, d.created_at, d.updated_at,
            t.subject AS ticket_subject,
            t.requester_email,
            t.status AS ticket_status,
            t.priority AS ticket_priority,
            t.assigned_user_id,
            EXISTS (
              SELECT 1 FROM messages msg
              WHERE msg.ticket_id = t.id
                AND msg.tenant_key = t.tenant_key
                AND msg.workspace_key = t.workspace_key
                AND msg.channel = 'whatsapp'
            ) OR t.requester_email ILIKE 'whatsapp:%' AS has_whatsapp,
            EXISTS (
              SELECT 1 FROM messages msg
              WHERE msg.ticket_id = t.id
                AND msg.tenant_key = t.tenant_key
                AND msg.workspace_key = t.workspace_key
                AND msg.channel = 'voice'
            ) OR t.requester_email ILIKE 'voice:%' AS has_voice
     FROM agent_drafts d
     JOIN tickets t
       ON t.id = d.ticket_id
      AND t.tenant_key = d.tenant_key
      AND t.workspace_key = d.workspace_key
     ${whereClause}
     ORDER BY d.created_at DESC
     LIMIT 200`,
    values
  );

  return result.rows;
}

export async function createDraft({
  integrationId,
  ticketId,
  tenantKey,
  workspaceKey,
  subject,
  bodyText,
  bodyHtml,
  confidence,
  metadata
}: {
  integrationId: string;
  ticketId: string;
  tenantKey?: string | null;
  workspaceKey?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  const result = await db.query<AgentDraft>(
    `INSERT INTO agent_drafts (
       tenant_key, workspace_key, integration_id, ticket_id, subject, body_text, body_html, confidence, metadata
     )
     SELECT ticket.tenant_key, ticket.workspace_key, integration.id, ticket.id, $3, $4, $5, $6, $7
     FROM tickets ticket
     JOIN agent_integrations integration
       ON integration.id = $1
      AND integration.tenant_key = ticket.tenant_key
     WHERE ticket.id = $2
       AND ticket.tenant_key = $8
       AND ticket.workspace_key = $9
     RETURNING id, tenant_key, workspace_key, integration_id, ticket_id, subject, body_text, body_html,
               confidence, metadata, status, created_at, updated_at`,
    [
      integrationId,
      ticketId,
      subject ?? null,
      bodyText ?? null,
      bodyHtml ?? null,
      confidence ?? null,
      metadata ?? null,
      scope.tenantKey,
      scope.workspaceKey
    ]
  );
  return result.rows[0] ?? null;
}

export async function updateDraftStatus({
  draftId,
  ticketId,
  status,
  tenantKey,
  workspaceKey
}: {
  draftId: string;
  ticketId: string;
  status: DraftStatus;
  tenantKey?: string | null;
  workspaceKey?: string | null;
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  const result = await db.query<AgentDraft>(
    `UPDATE agent_drafts
     SET status = $1, updated_at = now()
     WHERE id = $2
       AND ticket_id = $3
       AND status = 'pending'
       AND tenant_key = $4
       AND workspace_key = $5
       AND EXISTS (
         SELECT 1 FROM tickets t
         WHERE t.id = agent_drafts.ticket_id
           AND t.tenant_key = agent_drafts.tenant_key
           AND t.workspace_key = agent_drafts.workspace_key
       )
     RETURNING id, tenant_key, workspace_key, integration_id, ticket_id, subject, body_text, body_html,
               confidence, metadata, status, created_at, updated_at`,
    [status, draftId, ticketId, scope.tenantKey, scope.workspaceKey]
  );
  return result.rows[0] ?? null;
}

export async function updateDraftContent({
  draftId,
  ticketId,
  subject,
  bodyText,
  bodyHtml,
  tenantKey,
  workspaceKey
}: {
  draftId: string;
  ticketId: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  tenantKey?: string | null;
  workspaceKey?: string | null;
}) {
  const scope = resolveTenantScope({ tenantKey, workspaceKey });
  const result = await db.query<AgentDraft>(
    `UPDATE agent_drafts
     SET subject = $1,
         body_text = $2,
         body_html = $3,
         updated_at = now()
     WHERE id = $4
       AND ticket_id = $5
       AND status = 'pending'
       AND tenant_key = $6
       AND workspace_key = $7
       AND EXISTS (
         SELECT 1 FROM tickets t
         WHERE t.id = agent_drafts.ticket_id
           AND t.tenant_key = agent_drafts.tenant_key
           AND t.workspace_key = agent_drafts.workspace_key
       )
     RETURNING id, tenant_key, workspace_key, integration_id, ticket_id, subject, body_text, body_html,
               confidence, metadata, status, created_at, updated_at`,
    [subject, bodyText, bodyHtml, draftId, ticketId, scope.tenantKey, scope.workspaceKey]
  );
  return result.rows[0] ?? null;
}
