import { db } from "@/server/db";

export type InboundAlertConfig = {
  source: "db" | "env";
  webhookUrl: string;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
  updatedAt: string | null;
};

type InboundAlertConfigRow = {
  webhook_url: string | null;
  threshold: number;
  window_minutes: number;
  cooldown_minutes: number;
  updated_at: Date | null;
};

function parsePositive(value: string | number | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function normalizeWebhook(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function getInboundAlertConfig(): Promise<InboundAlertConfig> {
  const result = await db.query<InboundAlertConfigRow>(
    `SELECT webhook_url, threshold, window_minutes, cooldown_minutes, updated_at
     FROM inbound_alert_configs
     WHERE is_active = true
     ORDER BY created_at DESC
     LIMIT 1`
  );

  const row = result.rows[0];
  if (row) {
    return {
      source: "db",
      webhookUrl: normalizeWebhook(row.webhook_url),
      threshold: parsePositive(row.threshold, 5),
      windowMinutes: parsePositive(row.window_minutes, 30),
      cooldownMinutes: parsePositive(row.cooldown_minutes, 60),
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null
    };
  }

  return {
    source: "env",
    webhookUrl: normalizeWebhook(process.env.INBOUND_ALERT_WEBHOOK),
    threshold: parsePositive(process.env.INBOUND_ALERT_THRESHOLD, 5),
    windowMinutes: parsePositive(process.env.INBOUND_ALERT_WINDOW_MINUTES, 30),
    cooldownMinutes: parsePositive(process.env.INBOUND_ALERT_COOLDOWN_MINUTES, 60),
    updatedAt: null
  };
}

export async function saveInboundAlertConfig(input: {
  webhookUrl: string;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
}) {
  const webhookUrl = normalizeWebhook(input.webhookUrl);
  const threshold = parsePositive(input.threshold, 5);
  const windowMinutes = parsePositive(input.windowMinutes, 30);
  const cooldownMinutes = parsePositive(input.cooldownMinutes, 60);

  await db.query("UPDATE inbound_alert_configs SET is_active = false WHERE is_active = true");
  await db.query(
    `INSERT INTO inbound_alert_configs (
      webhook_url, threshold, window_minutes, cooldown_minutes, is_active, updated_at
    ) VALUES ($1, $2, $3, $4, true, now())`,
    [webhookUrl || null, threshold, windowMinutes, cooldownMinutes]
  );

  return getInboundAlertConfig();
}
