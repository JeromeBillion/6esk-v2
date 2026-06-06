import { db } from "@/server/db";

type WhatsAppAccountRow = {
  id: string;
  provider: string;
  phone_number: string;
  status: string;
  updated_at: Date;
};

type WhatsAppOutboxSummaryRow = {
  queued: number | string | null;
  due_now: number | string | null;
  processing: number | string | null;
  failed: number | string | null;
  sent_total: number | string | null;
  sent_24h: number | string | null;
  next_attempt_at: Date | null;
  last_sent_at: Date | null;
  last_failed_at: Date | null;
};

type WhatsAppOutboxErrorRow = {
  last_error: string | null;
};

function toNumber(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function getWhatsAppOutboxMetrics(tenantId?: string | null) {
  const values = tenantId ? [tenantId] : [];
  const tenantClause = tenantId ? "AND tenant_id = $1" : "";
  const accountResult = await db.query<WhatsAppAccountRow>(
    `SELECT id, provider, phone_number, status, updated_at
     FROM whatsapp_accounts
     WHERE 1 = 1
       ${tenantClause}
     ORDER BY created_at DESC
     LIMIT 1`,
    values
  );

  const summaryResult = await db.query<WhatsAppOutboxSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE status = 'queued' AND next_attempt_at <= now())::int AS due_now,
       COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_total,
       COUNT(*) FILTER (
         WHERE status = 'sent'
           AND updated_at >= now() - interval '24 hours'
       )::int AS sent_24h,
       MIN(next_attempt_at) FILTER (WHERE status = 'queued') AS next_attempt_at,
       MAX(updated_at) FILTER (WHERE status = 'sent') AS last_sent_at,
       MAX(updated_at) FILTER (WHERE status = 'failed') AS last_failed_at
     FROM whatsapp_events
     WHERE direction = 'outbound'
       ${tenantClause}`,
    values
  );

  const errorResult = await db.query<WhatsAppOutboxErrorRow>(
    `SELECT last_error
     FROM whatsapp_events
     WHERE direction = 'outbound'
       ${tenantClause}
       AND status = 'failed'
       AND last_error IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    values
  );

  const account = accountResult.rows[0] ?? null;
  const summary = summaryResult.rows[0] ?? {
    queued: 0,
    due_now: 0,
    processing: 0,
    failed: 0,
    sent_total: 0,
    sent_24h: 0,
    next_attempt_at: null,
    last_sent_at: null,
    last_failed_at: null
  };

  return {
    account: account
      ? {
          id: account.id,
          provider: account.provider,
          phoneNumber: account.phone_number,
          status: account.status,
          updatedAt: account.updated_at.toISOString()
        }
      : null,
    queue: {
      queued: toNumber(summary.queued),
      dueNow: toNumber(summary.due_now),
      processing: toNumber(summary.processing),
      failed: toNumber(summary.failed),
      sentTotal: toNumber(summary.sent_total),
      sent24h: toNumber(summary.sent_24h),
      nextAttemptAt: toIso(summary.next_attempt_at),
      lastSentAt: toIso(summary.last_sent_at),
      lastFailedAt: toIso(summary.last_failed_at),
      lastError: errorResult.rows[0]?.last_error ?? null
    }
  };
}
