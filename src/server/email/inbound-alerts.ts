import { db } from "@/server/db";
import { getInboundAlertConfig } from "@/server/email/inbound-alert-config";
import {
  aggregateInboundFailureReasons,
  type InboundFailureReason
} from "@/server/email/inbound-metrics";

type AlertResult = {
  sent: boolean;
  reason: string;
  failures: number;
  threshold: number;
  windowMinutes?: number;
  cooldownMinutes?: number;
  source?: "db" | "env";
  topFailureReasons?: InboundFailureReason[];
};

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

async function getTopFailureReasons(windowMinutes: number, limit = 3) {
  const result = await db.query<{ last_error: string | null; count: string | number }>(
    `SELECT
       COALESCE(NULLIF(last_error, ''), 'unknown') AS last_error,
       COUNT(*)::int AS count
     FROM inbound_events
     WHERE status = 'failed'
       AND created_at >= now() - ($1::text || ' minutes')::interval
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT 25`,
    [windowMinutes.toString()]
  );

  return aggregateInboundFailureReasons(result.rows, limit);
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
  const config = await getInboundAlertConfig();
  const webhook = config.webhookUrl;
  if (!webhook) {
    return {
      sent: false,
      reason: "missing_webhook",
      failures: 0,
      threshold: config.threshold,
      windowMinutes: config.windowMinutes,
      cooldownMinutes: config.cooldownMinutes,
      source: config.source
    };
  }

  const threshold = config.threshold;
  const windowMinutes = config.windowMinutes;
  const cooldownMinutes = config.cooldownMinutes;

  const failures = await getFailureCount(windowMinutes);
  if (failures < threshold) {
    return {
      sent: false,
      reason: "below_threshold",
      failures,
      threshold,
      windowMinutes,
      cooldownMinutes,
      source: config.source
    };
  }

  const lastSent = await getLastAlertSent();
  if (lastSent) {
    const elapsedMinutes = (Date.now() - lastSent.getTime()) / 60000;
    if (elapsedMinutes < cooldownMinutes) {
      return {
        sent: false,
        reason: "cooldown",
        failures,
        threshold,
        windowMinutes,
        cooldownMinutes,
        source: config.source
      };
    }
  }

  const topFailureReasons = await getTopFailureReasons(windowMinutes, 3);
  const topReasonSummary = topFailureReasons.length
    ? topFailureReasons.map((reason) => `${reason.label} (${reason.count})`).join(", ")
    : "No classified reasons";

  const payload = {
    text: `6esk inbound failures detected: ${failures} in the last ${windowMinutes} minutes. Top reasons: ${topReasonSummary}.`,
    failures,
    windowMinutes,
    threshold,
    topFailureReasons,
    timestamp: new Date().toISOString()
  };

  await sendWebhook(webhook, payload);
  await upsertLastAlertSent(new Date());

  return {
    sent: true,
    reason: "sent",
    failures,
    threshold,
    windowMinutes,
    cooldownMinutes,
    source: config.source,
    topFailureReasons
  };
}
