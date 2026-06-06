import { db } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { getVoiceOperatorPresence, listVoiceOperatorRoster, type VoiceOperatorStatus } from "@/server/calls/operators";
import { tenantScopeFromUser } from "@/server/tenant-context";

type DeskNotificationChannel = "support_email" | "whatsapp" | "inbox_email";

type DeskNotificationRow = {
  id: string;
  ticket_id: string | null;
  ticket_number: number | null;
  subject: string | null;
  preview_text: string | null;
  from_email: string | null;
  occurred_at: Date | null;
};

type TimestampRow = {
  value: Date | null;
};

function toIsoString(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function buildNotificationItem(channel: DeskNotificationChannel, row: DeskNotificationRow | null) {
  if (!row?.id) {
    return null;
  }

  return {
    id: row.id,
    channel,
    ticketId: row.ticket_id,
    ticketDisplayId:
      typeof row.ticket_number === "number" && Number.isFinite(row.ticket_number)
        ? `#${row.ticket_number}`
        : null,
    subject: row.subject,
    preview: row.preview_text,
    from: row.from_email,
    occurredAt: toIsoString(row.occurred_at)
  };
}

export async function getDeskLiveSnapshot(user: SessionUser) {
  const scope = tenantScopeFromUser(user);
  const { tenantKey } = scope;
  const [
    presence,
    supportVersionResult,
    inboxVersionResult,
    latestSupportEmailResult,
    latestWhatsAppResult,
    latestInboxEmailResult,
    roster
  ] = await Promise.all([
    getVoiceOperatorPresence(user.id, scope),
    db.query<TimestampRow>(
      `SELECT MAX(t.updated_at) AS value
       FROM tickets t
       LEFT JOIN mailboxes mb ON mb.id = t.mailbox_id AND mb.tenant_key = t.tenant_key
       WHERE t.merged_into_ticket_id IS NULL
         AND t.tenant_key = $1
         AND (t.mailbox_id IS NULL OR mb.type = 'platform')`
      ,
      [tenantKey]
    ),
    db.query<TimestampRow>(
      `SELECT MAX(COALESCE(m.received_at, m.sent_at, m.created_at)) AS value
       FROM messages m
       JOIN mailboxes mb ON mb.id = m.mailbox_id AND mb.tenant_key = m.tenant_key
       WHERE mb.type = 'personal'
         AND mb.owner_user_id = $1
         AND m.tenant_key = $2`,
      [user.id, tenantKey]
    ),
    db.query<DeskNotificationRow>(
      `SELECT
         m.id,
         m.ticket_id,
         t.ticket_number,
         COALESCE(m.subject, t.subject) AS subject,
         m.preview_text,
         m.from_email,
         COALESCE(m.received_at, m.created_at) AS occurred_at
       FROM messages m
       JOIN tickets t ON t.id = m.ticket_id AND t.tenant_key = m.tenant_key
       LEFT JOIN mailboxes mb ON mb.id = t.mailbox_id AND mb.tenant_key = t.tenant_key
       WHERE m.direction = 'inbound'
         AND m.tenant_key = $1
         AND m.channel = 'email'
         AND t.merged_into_ticket_id IS NULL
         AND (t.mailbox_id IS NULL OR mb.type = 'platform')
       ORDER BY COALESCE(m.received_at, m.created_at) DESC
       LIMIT 1`,
      [tenantKey]
    ),
    db.query<DeskNotificationRow>(
      `SELECT
         m.id,
         m.ticket_id,
         t.ticket_number,
         COALESCE(m.subject, t.subject) AS subject,
         m.preview_text,
         m.from_email,
         COALESCE(m.received_at, m.created_at) AS occurred_at
       FROM messages m
       JOIN tickets t ON t.id = m.ticket_id AND t.tenant_key = m.tenant_key
       LEFT JOIN mailboxes mb ON mb.id = t.mailbox_id AND mb.tenant_key = t.tenant_key
       WHERE m.direction = 'inbound'
         AND m.tenant_key = $1
         AND m.channel = 'whatsapp'
         AND t.merged_into_ticket_id IS NULL
         AND (t.mailbox_id IS NULL OR mb.type = 'platform')
       ORDER BY COALESCE(m.received_at, m.created_at) DESC
       LIMIT 1`,
      [tenantKey]
    ),
    db.query<DeskNotificationRow>(
      `SELECT
         m.id,
         m.ticket_id,
         t.ticket_number,
         COALESCE(m.subject, t.subject) AS subject,
         m.preview_text,
         m.from_email,
         COALESCE(m.received_at, m.created_at) AS occurred_at
       FROM messages m
       JOIN mailboxes mb ON mb.id = m.mailbox_id AND mb.tenant_key = m.tenant_key
       LEFT JOIN tickets t ON t.id = m.ticket_id AND t.tenant_key = m.tenant_key
       WHERE m.direction = 'inbound'
         AND m.channel = 'email'
         AND mb.type = 'personal'
         AND mb.owner_user_id = $1
         AND m.tenant_key = $2
       ORDER BY COALESCE(m.received_at, m.created_at) DESC
       LIMIT 1`,
      [user.id, tenantKey]
    ),
    listVoiceOperatorRoster(12, scope)
  ]);

  const operatorSummary = roster.reduce(
    (summary, operator) => {
      if (operator.status === "online" && operator.ringingCallSessionId) {
        summary.ringing += 1;
        return summary;
      }
      if (operator.status === "away") {
        summary.away += 1;
        return summary;
      }
      if (operator.status === "online" && operator.activeCallSessionId) {
        summary.busy += 1;
        return summary;
      }
      if (operator.status === "online") {
        summary.online += 1;
        return summary;
      }
      summary.offline += 1;
      return summary;
    },
    { online: 0, ringing: 0, busy: 0, away: 0, offline: 0 }
  );

  return {
    snapshotAt: new Date().toISOString(),
    presence,
    versions: {
      support: toIsoString(supportVersionResult.rows[0]?.value),
      inbox: toIsoString(inboxVersionResult.rows[0]?.value)
    },
    notifications: {
      latestSupportEmail: buildNotificationItem("support_email", latestSupportEmailResult.rows[0] ?? null),
      latestWhatsApp: buildNotificationItem("whatsapp", latestWhatsAppResult.rows[0] ?? null),
      latestInboxEmail: buildNotificationItem("inbox_email", latestInboxEmailResult.rows[0] ?? null)
    },
    operators: {
      summary: operatorSummary,
      roster: roster.map((operator) => ({
        userId: operator.userId,
        displayName: operator.displayName,
        email: operator.email,
        status: operator.status,
        activeCallSessionId: operator.activeCallSessionId,
        ringingCallSessionId: operator.ringingCallSessionId
      }))
    }
  };
}

export type DeskLiveSnapshot = Awaited<ReturnType<typeof getDeskLiveSnapshot>>;
