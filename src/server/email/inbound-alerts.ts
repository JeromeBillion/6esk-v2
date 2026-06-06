import { db } from "@/server/db";
import { getInboundAlertConfig } from "@/server/email/inbound-alert-config";
import {
  aggregateInboundFailureReasons,
  type InboundFailureReason
} from "@/server/email/inbound-metrics";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

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

async function getFailureCount(windowMinutes: number, scopeInput?: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text as count
     FROM inbound_events
     WHERE status = 'failed'
       AND tenant_key = $2
       AND created_at >= now() - ($1::text || ' minutes')::interval`,
    [windowMinutes.toString(), scope.tenantKey]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function getTopFailureReasons(windowMinutes: number, limit = 3, scopeInput?: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
  const result = await db.query<{ last_error: string | null; count: string | number }>(
    `SELECT
       COALESCE(NULLIF(last_error, ''), 'unknown') AS last_error,
       COUNT(*)::int AS count
     FROM inbound_events
     WHERE status = 'failed'
       AND tenant_key = $2
       AND created_at >= now() - ($1::text || ' minutes')::interval
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT 25`,
    [windowMinutes.toString(), scope.tenantKey]
  );

  return aggregateInboundFailureReasons(result.rows, limit);
}

async function getLastAlertSent(scopeInput?: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
  const result = await db.query<{ last_sent_at: string | null }>(
    `SELECT last_sent_at
     FROM inbound_alerts
     WHERE tenant_key = $1
       AND alert_type = 'inbound_failures'
     LIMIT 1`,
    [scope.tenantKey]
  );
  return result.rows[0]?.last_sent_at ? new Date(result.rows[0].last_sent_at) : null;
}

async function upsertLastAlertSent(timestamp: Date, scopeInput?: TenantScopeInput) {
  const scope = resolveTenantScope(scopeInput);
  await db.query(
    `INSERT INTO inbound_alerts (tenant_key, workspace_key, alert_type, last_sent_at)
     VALUES ($1, $2, 'inbound_failures', $3)
     ON CONFLICT (tenant_key, alert_type) DO UPDATE
       SET last_sent_at = EXCLUDED.last_sent_at`,
    [scope.tenantKey, scope.workspaceKey, timestamp]
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

export async function sendInboundFailureAlert(scopeInput?: TenantScopeInput): Promise<AlertResult> {
  const scope = resolveTenantScope(scopeInput);
  const config = await getInboundAlertConfig(scope);
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

  const failures = await getFailureCount(windowMinutes, scope);
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

  const lastSent = await getLastAlertSent(scope);
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

  const topFailureReasons = await getTopFailureReasons(windowMinutes, 3, scope);
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
  await upsertLastAlertSent(new Date(), scope);

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
