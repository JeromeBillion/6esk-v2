import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getDateRange, getTodayRangeUtc } from "@/server/analytics/dateRange";

type ChannelSummaryRow = {
  email_inbound: number | string | null;
  email_outbound: number | string | null;
  whatsapp_inbound: number | string | null;
  whatsapp_outbound: number | string | null;
  whatsapp_sent: number | string | null;
  whatsapp_delivered: number | string | null;
  whatsapp_read: number | string | null;
  whatsapp_failed: number | string | null;
};

function toInt(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const { start, end } = getDateRange(url.searchParams);
  const today = getTodayRangeUtc();

  const totalTicketsResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM tickets
     WHERE created_at >= $1 AND created_at < $2`,
    [start, end]
  );

  const openTicketsResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM tickets
     WHERE status NOT IN ('solved', 'closed')`
  );

  const createdTodayResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM tickets
     WHERE created_at >= $1 AND created_at < $2`,
    [today.start, today.end]
  );

  const solvedTodayResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM tickets
     WHERE solved_at >= $1 AND solved_at < $2`,
    [today.start, today.end]
  );

  const firstResponseResult = await db.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (r.first_response - t.created_at))) AS avg_seconds
     FROM tickets t
     JOIN LATERAL (
       SELECT MIN(sent_at) AS first_response
       FROM messages m
       WHERE m.ticket_id = t.id
         AND m.direction = 'outbound'
         AND m.sent_at IS NOT NULL
     ) r ON true
     WHERE t.created_at >= $1 AND t.created_at < $2
       AND r.first_response IS NOT NULL`,
    [start, end]
  );

  const resolutionResult = await db.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (t.solved_at - t.created_at))) AS avg_seconds
     FROM tickets t
     WHERE t.solved_at IS NOT NULL
       AND t.solved_at >= $1 AND t.solved_at < $2`,
    [start, end]
  );

  const channelSummaryResult = await db.query<ChannelSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE channel = 'email' AND direction = 'inbound')::int AS email_inbound,
       COUNT(*) FILTER (WHERE channel = 'email' AND direction = 'outbound')::int AS email_outbound,
       COUNT(*) FILTER (WHERE channel = 'whatsapp' AND direction = 'inbound')::int AS whatsapp_inbound,
       COUNT(*) FILTER (WHERE channel = 'whatsapp' AND direction = 'outbound')::int AS whatsapp_outbound,
       COUNT(*) FILTER (
         WHERE channel = 'whatsapp' AND direction = 'outbound' AND wa_status = 'sent'
       )::int AS whatsapp_sent,
       COUNT(*) FILTER (
         WHERE channel = 'whatsapp' AND direction = 'outbound' AND wa_status = 'delivered'
       )::int AS whatsapp_delivered,
       COUNT(*) FILTER (
         WHERE channel = 'whatsapp' AND direction = 'outbound' AND wa_status = 'read'
       )::int AS whatsapp_read,
       COUNT(*) FILTER (
         WHERE channel = 'whatsapp' AND direction = 'outbound' AND wa_status = 'failed'
       )::int AS whatsapp_failed
     FROM messages
     WHERE created_at >= $1 AND created_at < $2`,
    [start, end]
  );

  const channelSummary = channelSummaryResult.rows[0] ?? {
    email_inbound: 0,
    email_outbound: 0,
    whatsapp_inbound: 0,
    whatsapp_outbound: 0,
    whatsapp_sent: 0,
    whatsapp_delivered: 0,
    whatsapp_read: 0,
    whatsapp_failed: 0
  };

  return Response.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    totalTickets: totalTicketsResult.rows[0]?.count ?? 0,
    openTickets: openTicketsResult.rows[0]?.count ?? 0,
    ticketsCreatedToday: createdTodayResult.rows[0]?.count ?? 0,
    ticketsSolvedToday: solvedTodayResult.rows[0]?.count ?? 0,
    avgFirstResponseSeconds: Number(firstResponseResult.rows[0]?.avg_seconds ?? 0),
    avgResolutionSeconds: Number(resolutionResult.rows[0]?.avg_seconds ?? 0),
    channels: {
      email: {
        inbound: toInt(channelSummary.email_inbound),
        outbound: toInt(channelSummary.email_outbound)
      },
      whatsapp: {
        inbound: toInt(channelSummary.whatsapp_inbound),
        outbound: toInt(channelSummary.whatsapp_outbound),
        sent: toInt(channelSummary.whatsapp_sent),
        delivered: toInt(channelSummary.whatsapp_delivered),
        read: toInt(channelSummary.whatsapp_read),
        failed: toInt(channelSummary.whatsapp_failed)
      }
    }
  });
}
