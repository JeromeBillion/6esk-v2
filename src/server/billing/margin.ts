import { db } from "@/server/db";
import { estimateUsageRevenueCent } from "@/server/tenant/catalog";

type MarginRow = {
  module_key: string;
  usage_kind: string;
  provider_mode: string | null;
  quantity_total: string | number;
  cost_total_cent: string | number;
  event_count: string | number;
};

export type MarginSnapshot = {
  tenantId: string | null;
  scope: "tenant" | "global";
  windowDays: number;
  generatedAt: string;
  totals: {
    events: number;
    quantity: number;
    costCent: number;
    estimatedRevenueCent: number;
    estimatedMarginCent: number;
    estimatedMarginPct: number;
  };
  modules: Array<{
    moduleKey: string;
    events: number;
    quantity: number;
    costCent: number;
    estimatedRevenueCent: number;
    estimatedMarginCent: number;
    estimatedMarginPct: number;
  }>;
};

function clampWindowDays(value: number | undefined) {
  if (!Number.isFinite(value)) return 30;
  return Math.min(90, Math.max(1, Math.trunc(value ?? 30)));
}

function toNumber(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function marginPercent(revenueCent: number, costCent: number) {
  if (revenueCent <= 0) return 0;
  const margin = ((revenueCent - costCent) / revenueCent) * 100;
  return Math.round(margin * 100) / 100;
}

export async function getMarginSnapshot(input: {
  tenantId?: string | null;
  windowDays?: number;
}): Promise<MarginSnapshot> {
  const windowDays = clampWindowDays(input.windowDays);
  const params: unknown[] = [String(windowDays)];
  const conditions = [`created_at >= now() - ($1::text || ' days')::interval`];
  const tenantId = input.tenantId?.trim() || null;
  if (tenantId) {
    params.push(tenantId);
    conditions.push(`tenant_id = $${params.length}`);
  }
  const guardComment = tenantId ? "" : "/* tenant-query-guard: ignore internal-backoffice-global-margin-view */";
  const result = await db.query<MarginRow>(
     `${guardComment}
      SELECT
       module_key,
       usage_kind,
       provider_mode,
       SUM(quantity)::bigint AS quantity_total,
       SUM(cost_cent)::numeric AS cost_total_cent,
       COUNT(*)::bigint AS event_count
     FROM workspace_module_usage_events
     WHERE ${conditions.join(" AND ")}
     GROUP BY module_key, usage_kind, provider_mode
     ORDER BY module_key, usage_kind, provider_mode`,
    params
  );

  const moduleTotals = new Map<
    string,
    { events: number; quantity: number; costCent: number; estimatedRevenueCent: number }
  >();

  let events = 0;
  let quantity = 0;
  let costCent = 0;
  let estimatedRevenueCent = 0;

  for (const row of result.rows) {
    const moduleKey = row.module_key;
    const eventCount = toNumber(row.event_count);
    const quantityTotal = toNumber(row.quantity_total);
    const costTotalCent = toNumber(row.cost_total_cent);
    const revenueForRow = estimateUsageRevenueCent({
      moduleKey,
      usageKind: row.usage_kind,
      providerMode: row.provider_mode,
      quantity: quantityTotal,
      eventCount,
      costCent: costTotalCent
    });

    events += eventCount;
    quantity += quantityTotal;
    costCent += costTotalCent;
    estimatedRevenueCent += revenueForRow;

    const current = moduleTotals.get(moduleKey) ?? {
      events: 0,
      quantity: 0,
      costCent: 0,
      estimatedRevenueCent: 0
    };
    current.events += eventCount;
    current.quantity += quantityTotal;
    current.costCent += costTotalCent;
    current.estimatedRevenueCent += revenueForRow;
    moduleTotals.set(moduleKey, current);
  }

  return {
    tenantId,
    scope: tenantId ? "tenant" : "global",
    windowDays,
    generatedAt: new Date().toISOString(),
    totals: {
      events,
      quantity,
      costCent,
      estimatedRevenueCent,
      estimatedMarginCent: estimatedRevenueCent - costCent,
      estimatedMarginPct: marginPercent(estimatedRevenueCent, costCent)
    },
    modules: Array.from(moduleTotals.entries()).map(([moduleKey, value]) => ({
      moduleKey,
      events: value.events,
      quantity: value.quantity,
      costCent: value.costCent,
      estimatedRevenueCent: value.estimatedRevenueCent,
      estimatedMarginCent: value.estimatedRevenueCent - value.costCent,
      estimatedMarginPct: marginPercent(value.estimatedRevenueCent, value.costCent)
    }))
  };
}

export async function getTenantMarginSnapshot(input: {
  tenantId: string;
  windowDays?: number;
}): Promise<MarginSnapshot> {
  return getMarginSnapshot(input);
}
