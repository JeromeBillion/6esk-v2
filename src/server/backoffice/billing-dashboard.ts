import { db } from "@/server/db";
import { listBackofficeAuditPreview, type BackofficeAuditPreview } from "@/server/backoffice/audit-preview";
import { estimateUsageRevenueCent } from "@/server/tenant/catalog";
import { listTenants } from "@/server/tenant/lifecycle";
import type { TenantRecord } from "@/server/tenant/types";
import {
  getTenantBillingLifecycleSnapshot,
  type BillingLifecycleSnapshot
} from "@/server/billing/lifecycle";
import {
  getWorkspaceModuleUsageSummary,
  type WorkspaceModuleUsageSummary
} from "@/server/module-metering";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

type UsageAggregateRow = {
  tenant_id: string;
  module_key: string;
  usage_kind: string;
  provider_mode: string | null;
  quantity_total: string | number;
  cost_total_cent: string | number;
  event_count: string | number;
  last_seen_at: string | null;
};

type InvoiceAggregateRow = {
  tenant_id: string;
  open_invoice_count: string | number;
  open_receivables_cent: string | number;
  overdue_receivables_cent: string | number;
  invoice_total_cent: string | number;
  missing_line_count: string | number;
  last_invoice_at: string | null;
};

type AdjustmentAggregateRow = {
  tenant_id: string;
  pending_adjustment_cent: string | number;
  pending_adjustment_count: string | number;
  oldest_pending_adjustment_at: string | null;
};

type BillingAccountRow = {
  tenant_id: string;
  collection_status: string;
  dunning_status: string;
  billing_email: string | null;
};

type CollectionAggregateRow = {
  tenant_id: string;
  collection_event_count: string | number;
  failed_collection_event_count: string | number;
  last_collection_event_at: string | null;
};

type CollectionEventRow = {
  id: string;
  invoice_id: string | null;
  event_type: string;
  status: string;
  attempt_number: string | number;
  created_at: string;
  completed_at: string | null;
};

type AdjustmentRow = {
  id: string;
  adjustment_type: string;
  status: string;
  amount_cent: string | number;
  reason: string;
  source_invoice_id: string | null;
  applied_invoice_id: string | null;
  created_at: string;
  applied_at: string | null;
};

type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  line_type: string;
  module_key: string | null;
  usage_kind: string | null;
  description: string;
  quantity: string | number;
  amount_cent: string | number;
  currency: string;
  created_at: string;
};

export type BillingRiskFlag = {
  key: string;
  tone: "neutral" | "good" | "warn" | "danger";
  label: string;
  detail: string;
};

export type BackofficeBillingDashboard = {
  generatedAt: string;
  workspaceKey: string;
  windowDays: number;
  selectedTenantId: string | null;
  summary: {
    tenantCount: number;
    estimatedRevenueCent: number;
    costCent: number;
    estimatedMarginCent: number;
    estimatedMarginPct: number;
    openReceivablesCent: number;
    overdueReceivablesCent: number;
    pendingAdjustmentCent: number;
    collectionEventCount: number;
    flaggedTenantCount: number;
  };
  reconciliationFlags: BillingRiskFlag[];
  moduleProfitability: ModuleProfitabilityRow[];
  tenantRows: TenantFinancialHealthRow[];
  selectedTenant: {
    tenant: TenantFinancialHealthRow;
    lifecycle: BillingLifecycleSnapshot;
    usage: WorkspaceModuleUsageSummary;
    auditLogs: BackofficeAuditPreview[];
    collectionEvents: Array<{
      id: string;
      invoiceId: string | null;
      eventType: string;
      status: string;
      attemptNumber: number;
      createdAt: string;
      completedAt: string | null;
    }>;
    adjustments: Array<{
      id: string;
      type: string;
      status: string;
      amountCent: number;
      reason: string;
      sourceInvoiceId: string | null;
      appliedInvoiceId: string | null;
      createdAt: string;
      appliedAt: string | null;
    }>;
    invoiceLines: Array<{
      id: string;
      invoiceId: string;
      lineType: string;
      moduleKey: string | null;
      usageKind: string | null;
      description: string;
      quantity: number;
      amountCent: number;
      currency: string;
      createdAt: string;
    }>;
  } | null;
};

export type ModuleProfitabilityRow = {
  tenantId: string | null;
  moduleKey: string;
  usageKind: string;
  providerMode: string | null;
  events: number;
  quantity: number;
  costCent: number;
  estimatedRevenueCent: number;
  estimatedMarginCent: number;
  estimatedMarginPct: number;
  lastSeenAt: string | null;
};

export type TenantFinancialHealthRow = {
  tenantId: string;
  slug: string;
  displayName: string;
  status: string;
  plan: string;
  billingEmail: string | null;
  collectionStatus: string;
  dunningStatus: string;
  estimatedRevenueCent: number;
  costCent: number;
  estimatedMarginCent: number;
  estimatedMarginPct: number;
  eventCount: number;
  lastUsageAt: string | null;
  openInvoiceCount: number;
  openReceivablesCent: number;
  overdueReceivablesCent: number;
  pendingAdjustmentCent: number;
  pendingAdjustmentCount: number;
  oldestPendingAdjustmentAt: string | null;
  collectionEventCount: number;
  failedCollectionEventCount: number;
  missingInvoiceLineCount: number;
  flags: BillingRiskFlag[];
};

function clampWindowDays(value: number | undefined) {
  if (!Number.isFinite(value)) return 30;
  return Math.min(90, Math.max(1, Math.trunc(value ?? 30)));
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function marginPercent(revenueCent: number, costCent: number) {
  if (revenueCent <= 0) return 0;
  return Math.round(((revenueCent - costCent) / revenueCent) * 10_000) / 100;
}

function daysSince(value: string | null, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

export function buildTenantBillingFlags(input: {
  status: string;
  billingEmail: string | null;
  estimatedRevenueCent: number;
  costCent: number;
  estimatedMarginCent: number;
  estimatedMarginPct: number;
  eventCount: number;
  lastUsageAt: string | null;
  overdueReceivablesCent: number;
  pendingAdjustmentCent: number;
  pendingAdjustmentCount: number;
  oldestPendingAdjustmentAt: string | null;
  collectionStatus: string;
  dunningStatus: string;
  failedCollectionEventCount: number;
  missingInvoiceLineCount: number;
  now?: Date;
}): BillingRiskFlag[] {
  const flags: BillingRiskFlag[] = [];

  if (!input.billingEmail) {
    flags.push({
      key: "missing_billing_email",
      tone: "warn",
      label: "Missing billing email",
      detail: "Invoices and collection notices do not have a billing recipient."
    });
  }
  if (input.estimatedMarginCent < 0 || input.estimatedMarginPct < 0) {
    flags.push({
      key: "negative_margin",
      tone: "danger",
      label: "Negative margin",
      detail: "Direct runtime/provider cost exceeds the estimated customer bill."
    });
  }
  if ((input.status === "suspended" || input.status === "closed") && input.eventCount > 0) {
    flags.push({
      key: "inactive_tenant_usage",
      tone: "danger",
      label: "Inactive tenant usage",
      detail: "A suspended or closed tenant generated billable usage in the selected window."
    });
  }
  if (input.status === "active" && input.eventCount > 0) {
    const lastUsageDays = daysSince(input.lastUsageAt, input.now);
    if (lastUsageDays !== null && lastUsageDays >= 7) {
      flags.push({
        key: "stale_metering",
        tone: "warn",
        label: "Stale usage sync",
        detail: `No metering event has landed for ${lastUsageDays} days.`
      });
    }
  }
  if (input.overdueReceivablesCent > 0) {
    flags.push({
      key: "overdue_receivables",
      tone: "danger",
      label: "Overdue AR",
      detail: "Open or uncollectible invoices are past due."
    });
  }
  if (input.pendingAdjustmentCount > 0) {
    const pendingAge = daysSince(input.oldestPendingAdjustmentAt, input.now);
    flags.push({
      key: pendingAge !== null && pendingAge >= 14 ? "aged_pending_adjustment" : "pending_adjustment",
      tone: pendingAge !== null && pendingAge >= 14 ? "danger" : "warn",
      label: pendingAge !== null && pendingAge >= 14 ? "Aged adjustment" : "Pending adjustment",
      detail: `${input.pendingAdjustmentCount} adjustment(s) worth ${input.pendingAdjustmentCent} cent await invoice application.`
    });
  }
  if (input.dunningStatus === "active" || input.collectionStatus === "collections") {
    flags.push({
      key: "collections_active",
      tone: "warn",
      label: "Collections active",
      detail: "Tenant is in an active dunning or collections state."
    });
  }
  if (input.failedCollectionEventCount > 0) {
    flags.push({
      key: "failed_collection_event",
      tone: "warn",
      label: "Collection failure",
      detail: "Recent collection activity includes failed attempts."
    });
  }
  if (input.missingInvoiceLineCount > 0) {
    flags.push({
      key: "missing_invoice_lines",
      tone: "danger",
      label: "Missing invoice lines",
      detail: "One or more persisted invoices lack line evidence."
    });
  }
  if (input.costCent > 0 && input.estimatedRevenueCent === 0) {
    flags.push({
      key: "unbilled_provider_cost",
      tone: "danger",
      label: "Unbilled cost",
      detail: "Provider/runtime cost exists without an estimated customer bill."
    });
  } else if (input.costCent >= 500_000 && input.estimatedMarginPct < 10) {
    flags.push({
      key: "suspicious_spend_spike",
      tone: "warn",
      label: "Spend spike",
      detail: "High runtime/provider cost is near or above the customer bill estimate."
    });
  }

  flags.push({
    key: "provider_reconciliation_pending",
    tone: "neutral",
    label: "Provider reconciliation pending",
    detail: "Payment/provider dashboard evidence remains a post-deploy runtime check."
  });
  return flags;
}

function aggregateUsageRows(rows: UsageAggregateRow[]) {
  const byTenant = new Map<string, {
    events: number;
    quantity: number;
    costCent: number;
    estimatedRevenueCent: number;
    lastUsageAt: string | null;
  }>();
  const byModule = new Map<string, ModuleProfitabilityRow>();

  for (const row of rows) {
    const eventCount = toNumber(row.event_count);
    const quantity = toNumber(row.quantity_total);
    const costCent = toNumber(row.cost_total_cent);
    const estimatedRevenueCent = Math.round(estimateUsageRevenueCent({
      moduleKey: row.module_key,
      usageKind: row.usage_kind,
      providerMode: row.provider_mode,
      quantity,
      eventCount,
      costCent
    }));

    const tenant = byTenant.get(row.tenant_id) ?? {
      events: 0,
      quantity: 0,
      costCent: 0,
      estimatedRevenueCent: 0,
      lastUsageAt: null
    };
    tenant.events += eventCount;
    tenant.quantity += quantity;
    tenant.costCent += costCent;
    tenant.estimatedRevenueCent += estimatedRevenueCent;
    if (row.last_seen_at && (!tenant.lastUsageAt || row.last_seen_at > tenant.lastUsageAt)) {
      tenant.lastUsageAt = row.last_seen_at;
    }
    byTenant.set(row.tenant_id, tenant);

    const moduleKey = `${row.module_key}:${row.usage_kind}:${row.provider_mode ?? "none"}`;
    const moduleAggregate = byModule.get(moduleKey) ?? {
      tenantId: null,
      moduleKey: row.module_key,
      usageKind: row.usage_kind,
      providerMode: row.provider_mode,
      events: 0,
      quantity: 0,
      costCent: 0,
      estimatedRevenueCent: 0,
      estimatedMarginCent: 0,
      estimatedMarginPct: 0,
      lastSeenAt: null
    };
    moduleAggregate.events += eventCount;
    moduleAggregate.quantity += quantity;
    moduleAggregate.costCent += costCent;
    moduleAggregate.estimatedRevenueCent += estimatedRevenueCent;
    moduleAggregate.estimatedMarginCent = moduleAggregate.estimatedRevenueCent - moduleAggregate.costCent;
    moduleAggregate.estimatedMarginPct = marginPercent(moduleAggregate.estimatedRevenueCent, moduleAggregate.costCent);
    if (row.last_seen_at && (!moduleAggregate.lastSeenAt || row.last_seen_at > moduleAggregate.lastSeenAt)) {
      moduleAggregate.lastSeenAt = row.last_seen_at;
    }
    byModule.set(moduleKey, moduleAggregate);
  }

  return {
    byTenant,
    byModule: Array.from(byModule.values()).sort((left, right) => {
      const risk = left.estimatedMarginCent - right.estimatedMarginCent;
      return risk === 0 ? right.costCent - left.costCent : risk;
    })
  };
}

function mapRowsByTenant<T extends { tenant_id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.tenant_id, row]));
}

async function loadBillingAggregates(input: { workspaceKey: string; windowDays: number }) {
  const [usage, invoices, adjustments, accounts, collections] = await Promise.all([
    db.query<UsageAggregateRow>(
      `SELECT tenant_id,
              module_key,
              usage_kind,
              provider_mode,
              SUM(quantity)::numeric AS quantity_total,
              SUM(cost_cent)::numeric AS cost_total_cent,
              COUNT(*)::bigint AS event_count,
              MAX(created_at)::text AS last_seen_at
       FROM workspace_module_usage_events
       WHERE workspace_key = $1
         AND created_at >= now() - ($2::text || ' days')::interval
       GROUP BY tenant_id, module_key, usage_kind, provider_mode
       ORDER BY module_key, usage_kind, provider_mode`,
      [input.workspaceKey, String(input.windowDays)]
    ),
    db.query<InvoiceAggregateRow>(
      `WITH line_counts AS (
         SELECT invoice_id, COUNT(*)::bigint AS line_count
         FROM tenant_invoice_lines
         GROUP BY invoice_id
       )
       SELECT i.tenant_id,
              COUNT(*) FILTER (WHERE i.status IN ('draft', 'open', 'uncollectible'))::bigint AS open_invoice_count,
              COALESCE(SUM(i.amount_due_cent) FILTER (WHERE i.status IN ('open', 'uncollectible')), 0)::bigint AS open_receivables_cent,
              COALESCE(SUM(i.amount_due_cent) FILTER (WHERE i.status IN ('open', 'uncollectible') AND i.due_at IS NOT NULL AND i.due_at < now()), 0)::bigint AS overdue_receivables_cent,
              COALESCE(SUM(i.total_cent), 0)::bigint AS invoice_total_cent,
              COUNT(*) FILTER (WHERE COALESCE(l.line_count, 0) = 0)::bigint AS missing_line_count,
              MAX(i.created_at)::text AS last_invoice_at
       FROM tenant_invoices i
       LEFT JOIN line_counts l
         ON l.invoice_id = i.id
       WHERE i.workspace_key = $1
       GROUP BY i.tenant_id`,
      [input.workspaceKey]
    ),
    db.query<AdjustmentAggregateRow>(
      `SELECT tenant_id,
              COALESCE(SUM(amount_cent) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_adjustment_cent,
              COUNT(*) FILTER (WHERE status = 'pending')::bigint AS pending_adjustment_count,
              MIN(created_at) FILTER (WHERE status = 'pending')::text AS oldest_pending_adjustment_at
       FROM tenant_billing_adjustments
       WHERE workspace_key = $1
       GROUP BY tenant_id`,
      [input.workspaceKey]
    ),
    db.query<BillingAccountRow>(
      `SELECT tenant_id,
              collection_status,
              dunning_status,
              billing_email
       FROM tenant_billing_accounts
       WHERE workspace_key = $1`,
      [input.workspaceKey]
    ),
    db.query<CollectionAggregateRow>(
      `SELECT tenant_id,
              COUNT(*)::bigint AS collection_event_count,
              COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed_collection_event_count,
              MAX(created_at)::text AS last_collection_event_at
       FROM tenant_collection_events
       WHERE workspace_key = $1
       GROUP BY tenant_id`,
      [input.workspaceKey]
    )
  ]);

  return {
    usage: usage.rows,
    invoices: mapRowsByTenant(invoices.rows),
    adjustments: mapRowsByTenant(adjustments.rows),
    accounts: mapRowsByTenant(accounts.rows),
    collections: mapRowsByTenant(collections.rows)
  };
}

async function loadSelectedTenantEvidence(input: { tenantId: string; workspaceKey: string; windowDays: number }) {
  const [lifecycle, usage, auditLogs, collectionEvents, adjustments, invoiceLines] = await Promise.all([
    getTenantBillingLifecycleSnapshot({ tenantId: input.tenantId, workspaceKey: input.workspaceKey }),
    getWorkspaceModuleUsageSummary({
      tenantId: input.tenantId,
      workspaceKey: input.workspaceKey,
      windowDays: input.windowDays
    }),
    listBackofficeAuditPreview({ tenantId: input.tenantId, limit: 20 }),
    db.query<CollectionEventRow>(
      `SELECT id,
              invoice_id,
              event_type,
              status,
              attempt_number,
              created_at::text,
              completed_at::text
       FROM tenant_collection_events
       WHERE tenant_id = $1
         AND workspace_key = $2
       ORDER BY created_at DESC
       LIMIT 30`,
      [input.tenantId, input.workspaceKey]
    ),
    db.query<AdjustmentRow>(
      `SELECT id,
              adjustment_type,
              status,
              amount_cent,
              reason,
              source_invoice_id,
              applied_invoice_id,
              created_at::text,
              applied_at::text
       FROM tenant_billing_adjustments
       WHERE tenant_id = $1
         AND workspace_key = $2
       ORDER BY created_at DESC
       LIMIT 30`,
      [input.tenantId, input.workspaceKey]
    ),
    db.query<InvoiceLineRow>(
      `SELECT id,
              invoice_id,
              line_type,
              module_key,
              usage_kind,
              description,
              quantity,
              amount_cent,
              currency,
              created_at::text
       FROM tenant_invoice_lines
       WHERE tenant_id = $1
         AND workspace_key = $2
       ORDER BY created_at DESC
       LIMIT 80`,
      [input.tenantId, input.workspaceKey]
    )
  ]);

  return {
    lifecycle,
    usage,
    auditLogs,
    collectionEvents: collectionEvents.rows.map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      eventType: row.event_type,
      status: row.status,
      attemptNumber: toNumber(row.attempt_number),
      createdAt: row.created_at,
      completedAt: toIso(row.completed_at)
    })),
    adjustments: adjustments.rows.map((row) => ({
      id: row.id,
      type: row.adjustment_type,
      status: row.status,
      amountCent: toNumber(row.amount_cent),
      reason: row.reason,
      sourceInvoiceId: row.source_invoice_id,
      appliedInvoiceId: row.applied_invoice_id,
      createdAt: row.created_at,
      appliedAt: toIso(row.applied_at)
    })),
    invoiceLines: invoiceLines.rows.map((row) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      lineType: row.line_type,
      moduleKey: row.module_key,
      usageKind: row.usage_kind,
      description: row.description,
      quantity: toNumber(row.quantity),
      amountCent: toNumber(row.amount_cent),
      currency: row.currency,
      createdAt: row.created_at
    }))
  };
}

export async function getBackofficeBillingDashboard(input: {
  selectedTenantId?: string | null;
  workspaceKey?: string;
  windowDays?: number;
} = {}): Promise<BackofficeBillingDashboard> {
  const workspaceKey = input.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const windowDays = clampWindowDays(input.windowDays);
  const [tenants, aggregates] = await Promise.all([
    listTenants({ limit: 500 }),
    loadBillingAggregates({ workspaceKey, windowDays })
  ]);
  const usage = aggregateUsageRows(aggregates.usage);
  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const selectedTenantId =
    input.selectedTenantId && tenantsById.has(input.selectedTenantId)
      ? input.selectedTenantId
      : tenants[0]?.id ?? null;

  const tenantRows = tenants.map((tenant: TenantRecord): TenantFinancialHealthRow => {
    const usageTotals = usage.byTenant.get(tenant.id) ?? {
      events: 0,
      quantity: 0,
      costCent: 0,
      estimatedRevenueCent: 0,
      lastUsageAt: null
    };
    const invoices = aggregates.invoices.get(tenant.id);
    const adjustments = aggregates.adjustments.get(tenant.id);
    const account = aggregates.accounts.get(tenant.id);
    const collections = aggregates.collections.get(tenant.id);
    const estimatedMarginCent = usageTotals.estimatedRevenueCent - usageTotals.costCent;
    const row = {
      tenantId: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      status: tenant.status,
      plan: tenant.plan,
      billingEmail: account?.billing_email ?? null,
      collectionStatus: account?.collection_status ?? "not_configured",
      dunningStatus: account?.dunning_status ?? "not_configured",
      estimatedRevenueCent: usageTotals.estimatedRevenueCent,
      costCent: usageTotals.costCent,
      estimatedMarginCent,
      estimatedMarginPct: marginPercent(usageTotals.estimatedRevenueCent, usageTotals.costCent),
      eventCount: usageTotals.events,
      lastUsageAt: usageTotals.lastUsageAt,
      openInvoiceCount: toNumber(invoices?.open_invoice_count),
      openReceivablesCent: toNumber(invoices?.open_receivables_cent),
      overdueReceivablesCent: toNumber(invoices?.overdue_receivables_cent),
      pendingAdjustmentCent: toNumber(adjustments?.pending_adjustment_cent),
      pendingAdjustmentCount: toNumber(adjustments?.pending_adjustment_count),
      oldestPendingAdjustmentAt: toIso(adjustments?.oldest_pending_adjustment_at),
      collectionEventCount: toNumber(collections?.collection_event_count),
      failedCollectionEventCount: toNumber(collections?.failed_collection_event_count),
      missingInvoiceLineCount: toNumber(invoices?.missing_line_count),
      flags: [] as BillingRiskFlag[]
    };
    row.flags = buildTenantBillingFlags(row);
    return row;
  }).sort((left, right) => {
    const leftRisk = left.flags.filter((flag) => flag.tone === "danger").length * 3 +
      left.flags.filter((flag) => flag.tone === "warn").length;
    const rightRisk = right.flags.filter((flag) => flag.tone === "danger").length * 3 +
      right.flags.filter((flag) => flag.tone === "warn").length;
    return rightRisk - leftRisk || right.overdueReceivablesCent - left.overdueReceivablesCent;
  });

  const totals = tenantRows.reduce(
    (current, tenant) => {
      current.estimatedRevenueCent += tenant.estimatedRevenueCent;
      current.costCent += tenant.costCent;
      current.openReceivablesCent += tenant.openReceivablesCent;
      current.overdueReceivablesCent += tenant.overdueReceivablesCent;
      current.pendingAdjustmentCent += tenant.pendingAdjustmentCent;
      current.collectionEventCount += tenant.collectionEventCount;
      return current;
    },
    {
      estimatedRevenueCent: 0,
      costCent: 0,
      openReceivablesCent: 0,
      overdueReceivablesCent: 0,
      pendingAdjustmentCent: 0,
      collectionEventCount: 0
    }
  );
  const estimatedMarginCent = totals.estimatedRevenueCent - totals.costCent;
  const selectedTenantRow = selectedTenantId
    ? tenantRows.find((tenant) => tenant.tenantId === selectedTenantId) ?? null
    : null;
  const selectedEvidence = selectedTenantRow
    ? await loadSelectedTenantEvidence({ tenantId: selectedTenantRow.tenantId, workspaceKey, windowDays })
    : null;

  return {
    generatedAt: new Date().toISOString(),
    workspaceKey,
    windowDays,
    selectedTenantId,
    summary: {
      tenantCount: tenantRows.length,
      estimatedRevenueCent: totals.estimatedRevenueCent,
      costCent: totals.costCent,
      estimatedMarginCent,
      estimatedMarginPct: marginPercent(totals.estimatedRevenueCent, totals.costCent),
      openReceivablesCent: totals.openReceivablesCent,
      overdueReceivablesCent: totals.overdueReceivablesCent,
      pendingAdjustmentCent: totals.pendingAdjustmentCent,
      collectionEventCount: totals.collectionEventCount,
      flaggedTenantCount: tenantRows.filter((tenant) =>
        tenant.flags.some((flag) => flag.tone === "danger" || flag.tone === "warn")
      ).length
    },
    reconciliationFlags: [
      {
        key: "provider_reconciliation_pending",
        tone: "warn",
        label: "Provider reconciliation pending",
        detail: "Runtime/provider dashboards and payment exports are still deployed-evidence checks."
      },
      {
        key: "billing_lines_source_of_truth",
        tone: "good",
        label: "Server-side billing source",
        detail: "Cockpit money is derived from lifecycle tables and usage events, not client-side formulas."
      }
    ],
    moduleProfitability: usage.byModule,
    tenantRows,
    selectedTenant: selectedTenantRow && selectedEvidence
      ? {
          tenant: selectedTenantRow,
          ...selectedEvidence
        }
      : null
  };
}
