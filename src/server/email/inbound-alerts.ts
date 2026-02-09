import { db } from "@/server/db";

type AlertResult = {
  sent: boolean;
  reason: string;
  failures: number;
  threshold: number;
};

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function getFailureCount(windowMinutes: number) {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text as count
     FROM inbound_events
     WHERE status = 'failed'
       AND created_at >= now() - ($1::text || ' minutes')::interval`,
    [windowMinutes.toString()]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function getLastAlertSent() {
  const result = await db.query<{ last_sent_at: string | null }>(
    `SELECT last_sent_at
     FROM inbound_alerts
     WHERE alert_type = 'inbound_failures'
     LIMIT 1`
  );
  return result.rows[0]?.last_sent_at ? new Date(result.rows[0].last_sent_at) : null;
}

async function upsertLastAlertSent(timestamp: Date) {
  await db.query(
    `INSERT INTO inbound_alerts (alert_type, last_sent_at)
     VALUES ('inbound_failures', $1)
     ON CONFLICT (alert_type) DO UPDATE
       SET last_sent_at = EXCLUDED.last_sent_at`,
    [timestamp]
  );
}

async function sendWebhook(webhookUrl: string, payload: Record<string, unknown>) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Webhook failed with ${res.status}`);
  }
}

export async function sendInboundFailureAlert(): Promise<AlertResult> {
  const webhook = process.env.INBOUND_ALERT_WEBHOOK ?? "";
  if (!webhook) {
    return { sent: false, reason: "missing_webhook", failures: 0, threshold: 0 };
  }

  const threshold = parseNumber(process.env.INBOUND_ALERT_THRESHOLD, 5);
  const windowMinutes = parseNumber(process.env.INBOUND_ALERT_WINDOW_MINUTES, 30);
  const cooldownMinutes = parseNumber(process.env.INBOUND_ALERT_COOLDOWN_MINUTES, 60);

  const failures = await getFailureCount(windowMinutes);
  if (failures < threshold) {
    return { sent: false, reason: "below_threshold", failures, threshold };
  }

  const lastSent = await getLastAlertSent();
  if (lastSent) {
    const elapsedMinutes = (Date.now() - lastSent.getTime()) / 60000;
    if (elapsedMinutes < cooldownMinutes) {
      return { sent: false, reason: "cooldown", failures, threshold };
    }
  }

  const payload = {
    text: `6esk inbound failures detected: ${failures} in the last ${windowMinutes} minutes.`,
    failures,
    windowMinutes,
    threshold,
    timestamp: new Date().toISOString()
  };

  await sendWebhook(webhook, payload);
  await upsertLastAlertSent(new Date());

  return { sent: true, reason: "sent", failures, threshold };
}
