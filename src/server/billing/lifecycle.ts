import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { recordAuditLogWithClient } from "@/server/audit";
import {
  BASE_PLATFORM_FEE_CENT,
  MODULE_PRICES,
  estimateUsageRevenueCent,
  getAiModuleFee,
  type AiModuleBillingMode
} from "@/server/tenant/catalog";
import {
  DEFAULT_WORKSPACE_KEY,
  normalizeWorkspaceModules,
  type WorkspaceModuleFlags,
  type WorkspaceModuleKey
} from "@/server/workspace-modules";

type Queryable = {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
};

type BillingActionIdempotencyInput = {
  idempotencyKey?: string | null;
  idempotencyPayload?: Record<string, unknown> | null;
};

type BillingActionIdempotencyRow = {
  id: string;
  request_hash: string;
  status: "processing" | "completed";
  response: unknown;
};

export class BillingActionIdempotencyError extends Error {
  constructor(
    public readonly code: "idempotency_conflict" | "idempotency_replay" | "idempotency_in_progress",
    message: string,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = "BillingActionIdempotencyError";
  }
}

export function isBillingActionIdempotencyError(error: unknown): error is BillingActionIdempotencyError {
  return error instanceof BillingActionIdempotencyError;
}

export type BillingAdjustmentType = "credit" | "refund" | "write_off" | "proration";
export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";
export type CollectionEventType =
  | "invoice_opened"
  | "payment_attempted"
  | "payment_failed"
  | "reminder_sent"
  | "dunning_started"
  | "dunning_escalated"
  | "collections_paused"
  | "invoice_paid"
  | "invoice_voided"
  | "write_off_recorded";

const ALLOWED_INVOICE_STATUS_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["open", "void"],
  open: ["paid", "void", "uncollectible"],
  uncollectible: ["paid", "void"],
  paid: [],
  void: []
};

function canTransitionInvoiceStatus(current: InvoiceStatus, next: InvoiceStatus) {
  return current === next || ALLOWED_INVOICE_STATUS_TRANSITIONS[current].includes(next);
}

export type BillingSubscriptionItem = {
  itemKey: string;
  itemKind: "base" | "module" | "addon" | "usage_commit";
  moduleKey: WorkspaceModuleKey | null;
  displayName: string;
  quantity: number;
  unitAmountCent: number;
  amountCent: number;
  currency: string;
  pricingSource: string;
};

export type BillingEstimateLine = {
  lineType: "base" | "module" | "addon" | "usage" | BillingAdjustmentType | "tax";
  moduleKey: string | null;
  usageKind: string | null;
  description: string;
  quantity: number;
  unitAmountCent: number;
  amountCent: number;
  currency: string;
  metadata?: Record<string, unknown>;
};

type TenantBillingRow = {
  id: string;
  slug: string;
  display_name: string;
  plan: string;
  status: string;
  settings: Record<string, unknown> | null;
  modules: Partial<WorkspaceModuleFlags> | null;
};

type BillingAccountRow = {
  tenant_id: string;
  workspace_key: string;
  currency: string;
  vat_rate_bps: number;
  payment_terms_days: number;
  invoice_prefix: string;
  next_invoice_sequence: number;
  collection_status: string;
  dunning_status: string;
  billing_email: string | null;
};

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  workspace_key: string;
  status: string;
  plan_id: string;
  billing_interval: string;
  current_period_start: Date | string;
  current_period_end: Date | string;
  cancel_at_period_end: boolean;
  provider: string | null;
  provider_subscription_id: string | null;
};

type SubscriptionItemRow = {
  id: string;
  item_key: string;
  item_kind: BillingSubscriptionItem["itemKind"];
  module_key: WorkspaceModuleKey | null;
  display_name: string;
  quantity: number | string;
  unit_amount_cent: number | string;
  currency: string;
  pricing_source: string;
};

type UsageRow = {
  module_key: string;
  usage_kind: string;
  provider_mode: string | null;
  quantity_total: string | number;
  cost_total_cent: string | number;
  event_count: string | number;
};

type AdjustmentRow = {
  id: string;
  adjustment_type: BillingAdjustmentType;
  amount_cent: string | number;
  currency: string;
  reason: string;
  status: string;
  source_invoice_id: string | null;
  created_at: string | Date;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  status: InvoiceStatus;
  currency: string;
  period_start: string | Date;
  period_end: string | Date;
  subtotal_cent: string | number;
  usage_cent: string | number;
  adjustment_cent: string | number;
  tax_cent: string | number;
  total_cent: string | number;
  amount_due_cent: string | number;
  due_at: string | Date | null;
  issued_at: string | Date | null;
  paid_at: string | Date | null;
  voided_at: string | Date | null;
  created_at: string | Date;
};

type InvoiceLineRow = {
  id: string;
  line_type: BillingEstimateLine["lineType"];
  module_key: string | null;
  usage_kind: string | null;
  description: string;
  quantity: string | number;
  unit_amount_cent: string | number;
  amount_cent: string | number;
  currency: string;
};

export type CustomerSafeInvoiceExport = {
  formatVersion: "workspace-invoice-export.v1";
  generatedAt: string;
  workspaceKey: string;
  invoice: {
    id: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    planId: string;
    currency: string;
    periodStart: string;
    periodEnd: string;
    dueAt: string | null;
    issuedAt: string | null;
    paidAt: string | null;
    subtotalCent: number;
    usageCent: number;
    adjustmentCent: number;
    taxCent: number;
    totalCent: number;
    amountDueCent: number;
    lines: Array<{
      lineType: BillingEstimateLine["lineType"];
      moduleKey: string | null;
      usageKind: string | null;
      description: string;
      quantity: number;
      unitAmountCent: number;
      amountCent: number;
      currency: string;
    }>;
  };
};

export type BillingLifecycleSnapshot = {
  tenantId: string;
  workspaceKey: string;
  generatedAt: string;
  account: {
    currency: string;
    vatRateBps: number;
    paymentTermsDays: number;
    collectionStatus: string;
    dunningStatus: string;
    billingEmail: string | null;
  };
  subscription: {
    id: string | null;
    status: string;
    planId: string;
    periodStart: string;
    periodEnd: string;
    source: "persisted" | "catalog_current_modules";
    items: BillingSubscriptionItem[];
  };
  estimatedInvoice: {
    periodStart: string;
    periodEnd: string;
    subtotalCent: number;
    usageCent: number;
    adjustmentCent: number;
    taxCent: number;
    totalCent: number;
    amountDueCent: number;
    lines: BillingEstimateLine[];
  };
  pendingAdjustments: Array<{
    id: string;
    type: BillingAdjustmentType;
    amountCent: number;
    reason: string;
    sourceInvoiceId: string | null;
    createdAt: string;
  }>;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    periodStart: string;
    periodEnd: string;
    totalCent: number;
    amountDueCent: number;
    dueAt: string | null;
    issuedAt: string | null;
    paidAt: string | null;
  }>;
};

const MODULE_LABELS: Record<WorkspaceModuleKey, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  voice: "Voice",
  aiAutomation: "AI Automation",
  dexterOrchestration: "Dexter Orchestration",
  vanillaWebchat: "6esk Webchat"
};

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value: string | number | null | undefined) {
  return Math.trunc(toNumber(value));
}

function toIso(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function requiredIso(value: string | Date) {
  return toIso(value) ?? new Date(value).toISOString();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(",")}}`;
}

function billingActionRequestHash(input: {
  tenantId: string;
  workspaceKey: string;
  actionType: string;
  payload: Record<string, unknown>;
}) {
  return createHash("sha256")
    .update(stableJson(input))
    .digest("hex");
}

async function claimBillingActionIdempotency(
  queryable: Queryable,
  input: {
    tenantId: string;
    workspaceKey: string;
    actionType: string;
    actorUserId?: string | null;
  } & BillingActionIdempotencyInput
) {
  const idempotencyKey = input.idempotencyKey?.trim();
  if (!idempotencyKey) return null;

  const requestHash = billingActionRequestHash({
    tenantId: input.tenantId,
    workspaceKey: input.workspaceKey,
    actionType: input.actionType,
    payload: input.idempotencyPayload ?? {}
  });

  const inserted = await queryable.query<{ id: string }>(
    `INSERT INTO tenant_billing_action_idempotency (
       tenant_id,
       workspace_key,
       idempotency_key,
       action_type,
       request_hash,
       created_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, workspace_key, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.tenantId,
      input.workspaceKey,
      idempotencyKey,
      input.actionType,
      requestHash,
      input.actorUserId ?? null
    ]
  );
  if (inserted.rows[0]) return inserted.rows[0].id;

  const existing = await queryable.query<BillingActionIdempotencyRow>(
    `SELECT id,
            request_hash,
            status,
            response
     FROM tenant_billing_action_idempotency
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND idempotency_key = $3
     LIMIT 1
     FOR UPDATE`,
    [input.tenantId, input.workspaceKey, idempotencyKey]
  );
  const row = existing.rows[0];
  if (!row || row.request_hash !== requestHash) {
    throw new BillingActionIdempotencyError(
      "idempotency_conflict",
      "Idempotency key has already been used for a different billing action."
    );
  }
  if (row.status === "completed") {
    throw new BillingActionIdempotencyError(
      "idempotency_replay",
      "Billing action already completed.",
      row.response
    );
  }
  throw new BillingActionIdempotencyError(
    "idempotency_in_progress",
    "Billing action is already processing."
  );
}

async function completeBillingActionIdempotency(
  queryable: Queryable,
  idempotencyRowId: string | null,
  response: unknown
) {
  if (!idempotencyRowId) return;
  await queryable.query(
    `UPDATE tenant_billing_action_idempotency
     SET status = 'completed',
         response = $2::jsonb,
         completed_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [idempotencyRowId, JSON.stringify(response ?? null)]
  );
}

function startOfUtcMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export function currentBillingPeriod(now = new Date()) {
  const start = startOfUtcMonth(now);
  return {
    periodStart: start,
    periodEnd: addUtcMonths(start, 1)
  };
}

function aiModeFromSettings(settings: Record<string, unknown> | null | undefined): AiModuleBillingMode {
  const raw = typeof settings?.aiProviderMode === "string" ? settings.aiProviderMode.toLowerCase() : "";
  return raw === "byo" ? "byo" : "managed";
}

function enabledModules(modules: WorkspaceModuleFlags) {
  return Object.entries(modules)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key as WorkspaceModuleKey);
}

export function buildCatalogSubscriptionItems(input: {
  modules: WorkspaceModuleFlags;
  aiMode: AiModuleBillingMode;
  currency?: string;
}): BillingSubscriptionItem[] {
  const currency = input.currency ?? "ZAR";
  const items: BillingSubscriptionItem[] = [
    {
      itemKey: "core_os",
      itemKind: "base",
      moduleKey: null,
      displayName: "Core OS",
      quantity: 1,
      unitAmountCent: BASE_PLATFORM_FEE_CENT,
      amountCent: BASE_PLATFORM_FEE_CENT,
      currency,
      pricingSource: "catalog"
    }
  ];

  for (const moduleKey of enabledModules(input.modules)) {
    if (moduleKey === "email" || moduleKey === "vanillaWebchat") continue;
    const unitAmountCent =
      moduleKey === "aiAutomation"
        ? getAiModuleFee(input.aiMode)
        : MODULE_PRICES[moduleKey as keyof typeof MODULE_PRICES] ?? 0;
    if (unitAmountCent <= 0) continue;
    items.push({
      itemKey: `module:${moduleKey}`,
      itemKind: "module",
      moduleKey,
      displayName: MODULE_LABELS[moduleKey],
      quantity: 1,
      unitAmountCent,
      amountCent: unitAmountCent,
      currency,
      pricingSource: "catalog"
    });
  }

  return items;
}

export function calculateProrationCent(input: {
  previousAmountCent: number;
  nextAmountCent: number;
  periodStart: Date;
  periodEnd: Date;
  effectiveAt: Date;
}) {
  const delta = input.nextAmountCent - input.previousAmountCent;
  if (delta === 0) return 0;
  const periodMs = input.periodEnd.getTime() - input.periodStart.getTime();
  if (periodMs <= 0) return 0;
  const remainingMs = Math.max(0, input.periodEnd.getTime() - input.effectiveAt.getTime());
  if (remainingMs <= 0) return 0;
  return Math.round(delta * (remainingMs / periodMs));
}

function itemAmount(item: BillingSubscriptionItem | SubscriptionItemRow) {
  if ("amountCent" in item) return item.amountCent;
  return toInt(item.quantity) * toInt(item.unit_amount_cent);
}

function subscriptionItemFromRow(row: SubscriptionItemRow): BillingSubscriptionItem {
  const quantity = Math.max(1, toInt(row.quantity));
  const unitAmountCent = Math.max(0, toInt(row.unit_amount_cent));
  return {
    itemKey: row.item_key,
    itemKind: row.item_kind,
    moduleKey: row.module_key,
    displayName: row.display_name,
    quantity,
    unitAmountCent,
    amountCent: quantity * unitAmountCent,
    currency: row.currency,
    pricingSource: row.pricing_source
  };
}

async function getTenantBillingBase(
  queryable: Queryable,
  tenantId: string,
  workspaceKey: string
) {
  const result = await queryable.query<TenantBillingRow>(
    `SELECT t.id,
            t.slug,
            t.display_name,
            t.plan,
            t.status::text AS status,
            t.settings,
            wm.modules
     FROM tenants t
     LEFT JOIN workspace_modules wm
       ON wm.tenant_id = t.id
      AND wm.workspace_key = $2
     WHERE t.id = $1
     LIMIT 1`,
    [tenantId, workspaceKey]
  );
  return result.rows[0] ?? null;
}

async function ensureBillingAccount(queryable: Queryable, tenantId: string, workspaceKey: string) {
  const result = await queryable.query<BillingAccountRow>(
    `INSERT INTO tenant_billing_accounts (tenant_id, workspace_key)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id, workspace_key) DO UPDATE
       SET updated_at = tenant_billing_accounts.updated_at
     RETURNING tenant_id,
               workspace_key,
               currency,
               vat_rate_bps,
               payment_terms_days,
               invoice_prefix,
               next_invoice_sequence,
               collection_status,
               dunning_status,
               billing_email`,
    [tenantId, workspaceKey]
  );
  return result.rows[0];
}

async function getBillingAccount(queryable: Queryable, tenantId: string, workspaceKey: string) {
  const result = await queryable.query<BillingAccountRow>(
    `SELECT tenant_id,
            workspace_key,
            currency,
            vat_rate_bps,
            payment_terms_days,
            invoice_prefix,
            next_invoice_sequence,
            collection_status,
            dunning_status,
            billing_email
     FROM tenant_billing_accounts
     WHERE tenant_id = $1
       AND workspace_key = $2
     LIMIT 1`,
    [tenantId, workspaceKey]
  );
  return result.rows[0] ?? null;
}

async function getActiveSubscription(queryable: Queryable, tenantId: string, workspaceKey: string) {
  const subscriptionResult = await queryable.query<SubscriptionRow>(
    `SELECT id,
            tenant_id,
            workspace_key,
            status,
            plan_id,
            billing_interval,
            current_period_start,
            current_period_end,
            cancel_at_period_end,
            provider,
            provider_subscription_id
     FROM tenant_subscriptions
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND status IN ('trialing', 'active', 'past_due', 'paused')
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, workspaceKey]
  );
  const subscription = subscriptionResult.rows[0] ?? null;
  if (!subscription) return { subscription: null, items: [] as BillingSubscriptionItem[] };

  const itemsResult = await queryable.query<SubscriptionItemRow>(
    `SELECT id,
            item_key,
            item_kind,
            module_key,
            display_name,
            quantity,
            unit_amount_cent,
            currency,
            pricing_source
     FROM tenant_subscription_items
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND subscription_id = $3
       AND effective_to IS NULL
     ORDER BY item_kind, item_key`,
    [tenantId, workspaceKey, subscription.id]
  );
  return {
    subscription,
    items: itemsResult.rows.map(subscriptionItemFromRow)
  };
}

async function getUsageChargeLines(input: {
  queryable: Queryable;
  tenantId: string;
  workspaceKey: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
}) {
  const result = await input.queryable.query<UsageRow>(
    `SELECT module_key,
            usage_kind,
            provider_mode,
            SUM(quantity)::numeric AS quantity_total,
            SUM(cost_cent)::numeric AS cost_total_cent,
            COUNT(*)::bigint AS event_count
     FROM workspace_module_usage_events
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND created_at >= $3
       AND created_at < $4
     GROUP BY module_key, usage_kind, provider_mode
     ORDER BY module_key, usage_kind, provider_mode`,
    [input.tenantId, input.workspaceKey, input.periodStart, input.periodEnd]
  );

  return result.rows
    .map((row): BillingEstimateLine | null => {
      const eventCount = toNumber(row.event_count);
      const quantity = toNumber(row.quantity_total);
      const costCent = toNumber(row.cost_total_cent);
      const amountCent = Math.round(
        estimateUsageRevenueCent({
          moduleKey: row.module_key,
          usageKind: row.usage_kind,
          providerMode: row.provider_mode,
          quantity,
          eventCount,
          costCent
        })
      );
      if (amountCent === 0) return null;
      return {
        lineType: "usage",
        moduleKey: row.module_key,
        usageKind: row.usage_kind,
        description: `${MODULE_LABELS[row.module_key as WorkspaceModuleKey] ?? row.module_key} usage: ${row.usage_kind}`,
        quantity,
        unitAmountCent: eventCount > 0 ? Math.round(amountCent / eventCount) : amountCent,
        amountCent,
        currency: input.currency,
        metadata: {
          eventCount,
          providerMode: row.provider_mode,
          providerCostCent: costCent
        }
      };
    })
    .filter((line): line is BillingEstimateLine => line !== null);
}

async function getPendingAdjustments(queryable: Queryable, tenantId: string, workspaceKey: string) {
  const result = await queryable.query<AdjustmentRow>(
    `SELECT id,
            adjustment_type,
            amount_cent,
            currency,
            reason,
            status,
            source_invoice_id,
            created_at
     FROM tenant_billing_adjustments
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND status = 'pending'
     ORDER BY created_at ASC`,
    [tenantId, workspaceKey]
  );
  return result.rows;
}

async function getRecentInvoices(queryable: Queryable, tenantId: string, workspaceKey: string) {
  const result = await queryable.query<InvoiceRow>(
    `SELECT id,
            invoice_number,
            status,
            currency,
            period_start,
            period_end,
            subtotal_cent,
            usage_cent,
            adjustment_cent,
            tax_cent,
            total_cent,
            amount_due_cent,
            due_at,
            issued_at,
            paid_at,
            voided_at,
            created_at
     FROM tenant_invoices
     WHERE tenant_id = $1
       AND workspace_key = $2
     ORDER BY created_at DESC
     LIMIT 12`,
    [tenantId, workspaceKey]
  );
  return result.rows;
}

function taxCentFor(amountCent: number, vatRateBps: number) {
  return Math.round(Math.max(0, amountCent) * (vatRateBps / 10_000));
}

function adjustmentLineFromRow(row: AdjustmentRow): BillingEstimateLine {
  const amountCent = toInt(row.amount_cent);
  return {
    lineType: row.adjustment_type,
    moduleKey: null,
    usageKind: null,
    description: row.reason,
    quantity: 1,
    unitAmountCent: amountCent,
    amountCent,
    currency: row.currency,
    metadata: {
      adjustmentId: row.id,
      adjustmentType: row.adjustment_type,
      sourceInvoiceId: row.source_invoice_id
    }
  };
}

async function buildTenantBillingLifecycleSnapshot(queryable: Queryable, input: {
  tenantId: string;
  workspaceKey?: string;
  periodStart?: Date;
  periodEnd?: Date;
}): Promise<BillingLifecycleSnapshot> {
  const workspaceKey = input.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const period = input.periodStart && input.periodEnd
    ? { periodStart: input.periodStart, periodEnd: input.periodEnd }
    : currentBillingPeriod();

  const tenant = await getTenantBillingBase(queryable, input.tenantId, workspaceKey);
  if (!tenant) {
    throw new Error("Tenant not found.");
  }

  const account = (await getBillingAccount(queryable, input.tenantId, workspaceKey)) ?? {
    tenant_id: input.tenantId,
    workspace_key: workspaceKey,
    currency: "ZAR",
    vat_rate_bps: 0,
    payment_terms_days: 7,
    invoice_prefix: "6ESK-",
    next_invoice_sequence: 1,
    collection_status: "current",
    dunning_status: "none",
    billing_email: null
  };

  const active = await getActiveSubscription(queryable, input.tenantId, workspaceKey);
  const modules = normalizeWorkspaceModules(tenant.modules);
  const catalogItems = buildCatalogSubscriptionItems({
    modules,
    aiMode: aiModeFromSettings(tenant.settings),
    currency: account.currency
  });
  const subscriptionItems = active.items.length > 0 ? active.items : catalogItems;
  const subscriptionSource = active.subscription ? "persisted" : "catalog_current_modules";
  const subscriptionPeriodStart = active.subscription
    ? new Date(active.subscription.current_period_start)
    : period.periodStart;
  const subscriptionPeriodEnd = active.subscription
    ? new Date(active.subscription.current_period_end)
    : period.periodEnd;

  const subscriptionLines = subscriptionItems.map((item): BillingEstimateLine => ({
    lineType: item.itemKind === "base" ? "base" : "module",
    moduleKey: item.moduleKey,
    usageKind: null,
    description: item.displayName,
    quantity: item.quantity,
    unitAmountCent: item.unitAmountCent,
    amountCent: item.amountCent,
    currency: item.currency,
    metadata: {
      itemKey: item.itemKey,
      pricingSource: item.pricingSource
    }
  }));
  const usageLines = await getUsageChargeLines({
    queryable,
    tenantId: input.tenantId,
    workspaceKey,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    currency: account.currency
  });
  const adjustments = await getPendingAdjustments(queryable, input.tenantId, workspaceKey);
  const adjustmentLines = adjustments.map(adjustmentLineFromRow);
  const subtotalCent = subscriptionLines.reduce((total, line) => total + line.amountCent, 0);
  const usageCent = usageLines.reduce((total, line) => total + line.amountCent, 0);
  const adjustmentCent = adjustmentLines.reduce((total, line) => total + line.amountCent, 0);
  const taxableCent = Math.max(0, subtotalCent + usageCent + adjustmentCent);
  const taxCent = taxCentFor(taxableCent, account.vat_rate_bps);
  const totalCent = taxableCent + taxCent;
  const taxLine: BillingEstimateLine | null = taxCent > 0
    ? {
        lineType: "tax",
        moduleKey: null,
        usageKind: null,
        description: `VAT ${(account.vat_rate_bps / 100).toFixed(2)}%`,
        quantity: 1,
        unitAmountCent: taxCent,
        amountCent: taxCent,
        currency: account.currency
      }
    : null;
  const lines = [...subscriptionLines, ...usageLines, ...adjustmentLines, ...(taxLine ? [taxLine] : [])];
  const invoices = await getRecentInvoices(queryable, input.tenantId, workspaceKey);

  return {
    tenantId: input.tenantId,
    workspaceKey,
    generatedAt: new Date().toISOString(),
    account: {
      currency: account.currency,
      vatRateBps: account.vat_rate_bps,
      paymentTermsDays: account.payment_terms_days,
      collectionStatus: account.collection_status,
      dunningStatus: account.dunning_status,
      billingEmail: account.billing_email
    },
    subscription: {
      id: active.subscription?.id ?? null,
      status: active.subscription?.status ?? "not_configured",
      planId: active.subscription?.plan_id ?? tenant.plan,
      periodStart: subscriptionPeriodStart.toISOString(),
      periodEnd: subscriptionPeriodEnd.toISOString(),
      source: subscriptionSource,
      items: subscriptionItems
    },
    estimatedInvoice: {
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      subtotalCent,
      usageCent,
      adjustmentCent,
      taxCent,
      totalCent,
      amountDueCent: totalCent,
      lines
    },
    pendingAdjustments: adjustments.map((row) => ({
      id: row.id,
      type: row.adjustment_type,
      amountCent: toInt(row.amount_cent),
      reason: row.reason,
      sourceInvoiceId: row.source_invoice_id,
      createdAt: requiredIso(row.created_at)
    })),
    invoices: invoices.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      status: row.status,
      periodStart: requiredIso(row.period_start),
      periodEnd: requiredIso(row.period_end),
      totalCent: toInt(row.total_cent),
      amountDueCent: toInt(row.amount_due_cent),
      dueAt: toIso(row.due_at),
      issuedAt: toIso(row.issued_at),
      paidAt: toIso(row.paid_at)
    }))
  };
}

export async function getTenantBillingLifecycleSnapshot(input: {
  tenantId: string;
  workspaceKey?: string;
  periodStart?: Date;
  periodEnd?: Date;
}): Promise<BillingLifecycleSnapshot> {
  return buildTenantBillingLifecycleSnapshot(db, input);
}

export async function syncTenantSubscriptionFromCatalog(input: {
  tenantId: string;
  workspaceKey?: string;
  actorUserId?: string | null;
  effectiveAt?: Date;
} & BillingActionIdempotencyInput) {
  const workspaceKey = input.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const effectiveAt = input.effectiveAt ?? new Date();
  const period = currentBillingPeriod(effectiveAt);
  const client = await db.connect();
  let subscriptionId: string | null = null;
  let prorationAmountCent = 0;
  let items: BillingSubscriptionItem[] = [];
  try {
    await client.query("BEGIN");
    const tenant = await getTenantBillingBase(client, input.tenantId, workspaceKey);
    if (!tenant) {
      throw new Error("Tenant not found.");
    }
    await ensureBillingAccount(client, input.tenantId, workspaceKey);
    const idempotencyRowId = await claimBillingActionIdempotency(client, {
      tenantId: input.tenantId,
      workspaceKey,
      actionType: "sync_subscription",
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      idempotencyPayload: input.idempotencyPayload
    });

    const modules = normalizeWorkspaceModules(tenant.modules);
    items = buildCatalogSubscriptionItems({
      modules,
      aiMode: aiModeFromSettings(tenant.settings)
    });

    const existingResult = await client.query<SubscriptionRow>(
      `SELECT id,
              tenant_id,
              workspace_key,
              status,
              plan_id,
              billing_interval,
              current_period_start,
              current_period_end,
              cancel_at_period_end,
              provider,
              provider_subscription_id
       FROM tenant_subscriptions
       WHERE tenant_id = $1
         AND workspace_key = $2
         AND status IN ('trialing', 'active', 'past_due', 'paused')
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [input.tenantId, workspaceKey]
    );
    let subscription = existingResult.rows[0] ?? null;
    let previousAmountCent = 0;
    if (subscription) {
      const previousItems = await client.query<SubscriptionItemRow>(
        `SELECT id,
                item_key,
                item_kind,
                module_key,
                display_name,
                quantity,
                unit_amount_cent,
                currency,
                pricing_source
         FROM tenant_subscription_items
         WHERE tenant_id = $1
           AND workspace_key = $2
           AND subscription_id = $3
           AND effective_to IS NULL`,
        [input.tenantId, workspaceKey, subscription.id]
      );
      previousAmountCent = previousItems.rows.reduce((total, row) => total + itemAmount(row), 0);
      await client.query(
        `UPDATE tenant_subscription_items
         SET effective_to = $4
         WHERE tenant_id = $1
           AND workspace_key = $2
           AND subscription_id = $3
           AND effective_to IS NULL`,
        [input.tenantId, workspaceKey, subscription.id, effectiveAt]
      );
    } else {
      const inserted = await client.query<SubscriptionRow>(
        `INSERT INTO tenant_subscriptions (
           tenant_id,
           workspace_key,
           status,
           plan_id,
           billing_interval,
           current_period_start,
           current_period_end
         )
         VALUES ($1, $2, 'active', $3, 'month', $4, $5)
         RETURNING id,
                   tenant_id,
                   workspace_key,
                   status,
                   plan_id,
                   billing_interval,
                   current_period_start,
                   current_period_end,
                   cancel_at_period_end,
                   provider,
                   provider_subscription_id`,
        [input.tenantId, workspaceKey, tenant.plan, period.periodStart, period.periodEnd]
      );
      subscription = inserted.rows[0];
    }

    subscriptionId = subscription.id;
    for (const item of items) {
      await client.query(
        `INSERT INTO tenant_subscription_items (
           subscription_id,
           tenant_id,
           workspace_key,
           item_key,
           item_kind,
           module_key,
           display_name,
           quantity,
           unit_amount_cent,
           currency,
           pricing_source,
           effective_from,
           metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
        [
          subscription.id,
          input.tenantId,
          workspaceKey,
          item.itemKey,
          item.itemKind,
          item.moduleKey,
          item.displayName,
          item.quantity,
          item.unitAmountCent,
          item.currency,
          item.pricingSource,
          effectiveAt,
          JSON.stringify({ source: "catalog_sync" })
        ]
      );
    }

    const nextAmountCent = items.reduce((total, item) => total + item.amountCent, 0);
    if (existingResult.rows[0]) {
      prorationAmountCent = calculateProrationCent({
        previousAmountCent,
        nextAmountCent,
        periodStart: new Date(subscription.current_period_start),
        periodEnd: new Date(subscription.current_period_end),
        effectiveAt
      });
      if (prorationAmountCent !== 0) {
        await client.query(
          `INSERT INTO tenant_billing_adjustments (
             tenant_id,
             workspace_key,
             adjustment_type,
             amount_cent,
             reason,
             created_by_user_id,
             metadata
           )
           VALUES ($1, $2, 'proration', $3, $4, $5, $6::jsonb)`,
          [
            input.tenantId,
            workspaceKey,
            prorationAmountCent,
            "Module subscription changed mid-period",
            input.actorUserId ?? null,
            JSON.stringify({
              previousAmountCent,
              nextAmountCent,
              subscriptionId: subscription.id
            })
          ]
        );
      }
    }

    await client.query(
      `UPDATE tenant_subscriptions
       SET plan_id = $3,
           updated_at = now()
       WHERE id = $1
         AND tenant_id = $2`,
      [subscription.id, input.tenantId, tenant.plan]
    );
    await recordAuditLogWithClient(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "tenant_subscription_synced",
      entityType: "tenant_subscription",
      entityId: subscriptionId,
      data: {
        workspaceKey,
        itemCount: items.length,
        prorationAmountCent
      }
    });
    await completeBillingActionIdempotency(client, idempotencyRowId, {
      subscriptionId,
      items,
      prorationAmountCent
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    subscriptionId,
    items,
    prorationAmountCent
  };
}

export async function createBillingAdjustment(input: {
  tenantId: string;
  workspaceKey?: string;
  adjustmentType: BillingAdjustmentType;
  amountCent: number;
  reason: string;
  actorUserId?: string | null;
  sourceInvoiceId?: string | null;
  metadata?: Record<string, unknown> | null;
} & BillingActionIdempotencyInput) {
  const workspaceKey = input.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const normalizedAmount =
    input.adjustmentType === "credit" ||
    input.adjustmentType === "refund" ||
    input.adjustmentType === "write_off"
      ? -Math.abs(Math.trunc(input.amountCent))
      : Math.trunc(input.amountCent);
  if (normalizedAmount === 0) {
    throw new Error("Billing adjustment amount must be non-zero.");
  }
  const client = await db.connect();
  let adjustment: AdjustmentRow | null = null;
  try {
    await client.query("BEGIN");
    await ensureBillingAccount(client, input.tenantId, workspaceKey);
    const idempotencyRowId = await claimBillingActionIdempotency(client, {
      tenantId: input.tenantId,
      workspaceKey,
      actionType: "create_adjustment",
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      idempotencyPayload: input.idempotencyPayload
    });
    const result = await client.query<AdjustmentRow>(
      `INSERT INTO tenant_billing_adjustments (
         tenant_id,
         workspace_key,
         adjustment_type,
         amount_cent,
         reason,
         source_invoice_id,
         created_by_user_id,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id,
                 adjustment_type,
                 amount_cent,
                 currency,
                 reason,
                 status,
                 source_invoice_id,
                 created_at`,
      [
        input.tenantId,
        workspaceKey,
        input.adjustmentType,
        normalizedAmount,
        input.reason,
        input.sourceInvoiceId ?? null,
        input.actorUserId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    adjustment = result.rows[0];
    await recordAuditLogWithClient(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "tenant_billing_adjustment_created",
      entityType: "tenant_billing_adjustment",
      entityId: adjustment.id,
      data: {
        workspaceKey,
        adjustmentType: input.adjustmentType,
        amountCent: normalizedAmount,
        sourceInvoiceId: input.sourceInvoiceId ?? null
      }
    });
    await completeBillingActionIdempotency(client, idempotencyRowId, adjustment);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!adjustment) {
    throw new Error("Billing adjustment was not created.");
  }
  return adjustment;
}

function invoiceNumber(prefix: string, sequence: number, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${prefix}${year}${month}-${String(sequence).padStart(6, "0")}`;
}

export async function createInvoiceDraft(input: {
  tenantId: string;
  workspaceKey?: string;
  actorUserId?: string | null;
  periodStart?: Date;
  periodEnd?: Date;
} & BillingActionIdempotencyInput) {
  const workspaceKey = input.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const client = await db.connect();
  let invoice: InvoiceRow | null = null;
  try {
    await client.query("BEGIN");
    const account = await ensureBillingAccount(client, input.tenantId, workspaceKey);
    const idempotencyRowId = await claimBillingActionIdempotency(client, {
      tenantId: input.tenantId,
      workspaceKey,
      actionType: "create_invoice_draft",
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      idempotencyPayload: input.idempotencyPayload
    });
    const snapshot = await buildTenantBillingLifecycleSnapshot(client, {
      tenantId: input.tenantId,
      workspaceKey,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd
    });
    const existingInvoice = await client.query<InvoiceRow>(
      `SELECT id,
              invoice_number,
              status,
              currency,
              period_start,
              period_end,
              subtotal_cent,
              usage_cent,
              adjustment_cent,
              tax_cent,
              total_cent,
              amount_due_cent,
              due_at,
              issued_at,
              paid_at,
              voided_at,
              created_at
       FROM tenant_invoices
       WHERE tenant_id = $1
         AND workspace_key = $2
         AND period_start = $3
         AND period_end = $4
         AND status IN ('draft', 'open', 'paid', 'uncollectible')
       ORDER BY created_at DESC
       LIMIT 1`,
      [
        input.tenantId,
        workspaceKey,
        snapshot.estimatedInvoice.periodStart,
        snapshot.estimatedInvoice.periodEnd
      ]
    );
    if (existingInvoice.rows[0]) {
      throw new Error("An active invoice already exists for this billing period.");
    }
    const adjustmentIds = snapshot.estimatedInvoice.lines
      .map((line) => line.metadata?.adjustmentId)
      .filter((value): value is string => typeof value === "string");
    const number = invoiceNumber(account.invoice_prefix, account.next_invoice_sequence);
    await client.query(
      `UPDATE tenant_billing_accounts
       SET next_invoice_sequence = next_invoice_sequence + 1,
           updated_at = now()
       WHERE tenant_id = $1
         AND workspace_key = $2`,
      [input.tenantId, workspaceKey]
    );
    const invoiceResult = await client.query<InvoiceRow>(
      `INSERT INTO tenant_invoices (
         tenant_id,
         workspace_key,
         invoice_number,
         status,
         currency,
         period_start,
         period_end,
         subscription_id,
         subtotal_cent,
         usage_cent,
         adjustment_cent,
         tax_cent,
         total_cent,
         amount_due_cent,
         metadata
       )
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
       RETURNING id,
                 invoice_number,
                 status,
                 currency,
                 period_start,
                 period_end,
                 subtotal_cent,
                 usage_cent,
                 adjustment_cent,
                 tax_cent,
                 total_cent,
                 amount_due_cent,
                 due_at,
                 issued_at,
                 paid_at,
                 voided_at,
                 created_at`,
      [
        input.tenantId,
        workspaceKey,
        number,
        snapshot.account.currency,
        snapshot.estimatedInvoice.periodStart,
        snapshot.estimatedInvoice.periodEnd,
        snapshot.subscription.id,
        snapshot.estimatedInvoice.subtotalCent,
        snapshot.estimatedInvoice.usageCent,
        snapshot.estimatedInvoice.adjustmentCent,
        snapshot.estimatedInvoice.taxCent,
        snapshot.estimatedInvoice.totalCent,
        snapshot.estimatedInvoice.amountDueCent,
        JSON.stringify({ generatedFrom: "billing_lifecycle_snapshot" })
      ]
    );
    invoice = invoiceResult.rows[0];

    for (const line of snapshot.estimatedInvoice.lines) {
      await client.query(
        `INSERT INTO tenant_invoice_lines (
           invoice_id,
           tenant_id,
           workspace_key,
           line_type,
           module_key,
           usage_kind,
           description,
           quantity,
           unit_amount_cent,
           amount_cent,
           currency,
           metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
        [
          invoice.id,
          input.tenantId,
          workspaceKey,
          line.lineType,
          line.moduleKey,
          line.usageKind,
          line.description,
          line.quantity,
          line.unitAmountCent,
          line.amountCent,
          line.currency,
          JSON.stringify(line.metadata ?? {})
        ]
      );
    }

    if (adjustmentIds.length > 0) {
      await client.query(
        `UPDATE tenant_billing_adjustments
         SET status = 'applied',
             applied_invoice_id = $3,
             applied_at = now()
         WHERE tenant_id = $1
           AND workspace_key = $2
           AND id = ANY($4::uuid[])
           AND status = 'pending'`,
        [input.tenantId, workspaceKey, invoice.id, adjustmentIds]
      );
    }

    await recordAuditLogWithClient(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "tenant_invoice_draft_created",
      entityType: "tenant_invoice",
      entityId: invoice.id,
      data: {
        workspaceKey,
        invoiceNumber: invoice.invoice_number,
        totalCent: toInt(invoice.total_cent)
      }
    });
    await completeBillingActionIdempotency(client, idempotencyRowId, invoice);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return invoice;
}

export async function transitionInvoiceStatus(input: {
  tenantId: string;
  workspaceKey?: string;
  invoiceId: string;
  status: Exclude<InvoiceStatus, "draft">;
  actorUserId?: string | null;
  reason?: string | null;
} & BillingActionIdempotencyInput) {
  const workspaceKey = input.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const client = await db.connect();
  let invoice: InvoiceRow | null = null;
  try {
    await client.query("BEGIN");
    await ensureBillingAccount(client, input.tenantId, workspaceKey);
    const idempotencyRowId = await claimBillingActionIdempotency(client, {
      tenantId: input.tenantId,
      workspaceKey,
      actionType: "transition_invoice",
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      idempotencyPayload: input.idempotencyPayload
    });
    const currentInvoice = await client.query<{ status: InvoiceStatus; invoice_number: string }>(
      `SELECT status,
              invoice_number
       FROM tenant_invoices
       WHERE id = $1
         AND tenant_id = $2
         AND workspace_key = $3
       LIMIT 1
       FOR UPDATE`,
      [input.invoiceId, input.tenantId, workspaceKey]
    );
    const currentStatus = currentInvoice.rows[0]?.status;
    if (!currentStatus) {
      throw new Error("Invoice not found.");
    }
    if (!canTransitionInvoiceStatus(currentStatus, input.status)) {
      await recordAuditLogWithClient(client, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId ?? null,
        action: "tenant_invoice_transition_rejected",
        entityType: "tenant_invoice",
        entityId: input.invoiceId,
        data: {
          workspaceKey,
          invoiceNumber: currentInvoice.rows[0]?.invoice_number ?? null,
          currentStatus,
          requestedStatus: input.status,
          reason: input.reason ?? null
        }
      });
      throw new Error(`Invoice status cannot transition from ${currentStatus} to ${input.status}.`);
    }

    const result = await client.query<InvoiceRow>(
      `UPDATE tenant_invoices i
       SET status = $4,
           issued_at = CASE WHEN $4 = 'open' THEN COALESCE(i.issued_at, now()) ELSE i.issued_at END,
           due_at = CASE
             WHEN $4 = 'open' THEN COALESCE(i.due_at, now() + (a.payment_terms_days::text || ' days')::interval)
             ELSE i.due_at
           END,
           paid_at = CASE WHEN $4 = 'paid' THEN COALESCE(i.paid_at, now()) ELSE i.paid_at END,
           voided_at = CASE WHEN $4 = 'void' THEN COALESCE(i.voided_at, now()) ELSE i.voided_at END,
           amount_due_cent = CASE WHEN $4 IN ('paid', 'void') THEN 0 ELSE i.amount_due_cent END,
           updated_at = now()
       FROM tenant_billing_accounts a
       WHERE i.id = $1
         AND i.tenant_id = $2
         AND i.workspace_key = $3
         AND i.status = $5
         AND a.tenant_id = i.tenant_id
         AND a.workspace_key = i.workspace_key
       RETURNING i.id,
                 i.invoice_number,
                 i.status,
                 i.currency,
                 i.period_start,
                 i.period_end,
                 i.subtotal_cent,
                 i.usage_cent,
                 i.adjustment_cent,
                 i.tax_cent,
                 i.total_cent,
                 i.amount_due_cent,
                 i.due_at,
                 i.issued_at,
                 i.paid_at,
                 i.voided_at,
                 i.created_at`,
      [input.invoiceId, input.tenantId, workspaceKey, input.status, currentStatus]
    );
    invoice = result.rows[0] ?? null;
    if (!invoice) {
      throw new Error("Invoice not found.");
    }

    if (input.status === "paid") {
      await client.query(
        `UPDATE tenant_billing_accounts
         SET collection_status = 'current',
             dunning_status = 'none',
             updated_at = now()
         WHERE tenant_id = $1
           AND workspace_key = $2`,
        [input.tenantId, workspaceKey]
      );
    } else if (input.status === "uncollectible") {
      await client.query(
        `UPDATE tenant_billing_accounts
         SET collection_status = 'collections',
             dunning_status = 'active',
             updated_at = now()
         WHERE tenant_id = $1
           AND workspace_key = $2`,
        [input.tenantId, workspaceKey]
      );
    }

    await recordAuditLogWithClient(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: `tenant_invoice_${input.status}`,
      entityType: "tenant_invoice",
      entityId: input.invoiceId,
      data: {
        workspaceKey,
        invoiceNumber: invoice.invoice_number,
        reason: input.reason ?? null
      }
    });
    await completeBillingActionIdempotency(client, idempotencyRowId, invoice);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!invoice) {
    throw new Error("Invoice not found.");
  }
  return invoice;
}

export async function recordCollectionEvent(input: {
  tenantId: string;
  workspaceKey?: string;
  invoiceId?: string | null;
  eventType: CollectionEventType;
  status?: "pending" | "sent" | "succeeded" | "failed" | "canceled";
  attemptNumber?: number;
  actorUserId?: string | null;
  metadata?: Record<string, unknown> | null;
} & BillingActionIdempotencyInput) {
  const workspaceKey = input.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const client = await db.connect();
  let event: { id: string } | null = null;
  try {
    await client.query("BEGIN");
    await ensureBillingAccount(client, input.tenantId, workspaceKey);
    const idempotencyRowId = await claimBillingActionIdempotency(client, {
      tenantId: input.tenantId,
      workspaceKey,
      actionType: "record_collection_event",
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      idempotencyPayload: input.idempotencyPayload
    });
    const result = await client.query<{ id: string }>(
      `INSERT INTO tenant_collection_events (
         tenant_id,
         workspace_key,
         invoice_id,
         event_type,
         status,
         attempt_number,
         completed_at,
         actor_user_id,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 IN ('succeeded', 'failed', 'sent', 'canceled') THEN now() ELSE NULL END, $7, $8::jsonb)
       RETURNING id`,
      [
        input.tenantId,
        workspaceKey,
        input.invoiceId ?? null,
        input.eventType,
        input.status ?? "pending",
        Math.max(1, Math.trunc(input.attemptNumber ?? 1)),
        input.actorUserId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    event = result.rows[0] ?? null;

    if (input.eventType === "dunning_started" || input.eventType === "dunning_escalated") {
      await client.query(
        `UPDATE tenant_billing_accounts
         SET collection_status = 'collections',
             dunning_status = 'active',
             updated_at = now()
         WHERE tenant_id = $1
           AND workspace_key = $2`,
        [input.tenantId, workspaceKey]
      );
    } else if (input.eventType === "collections_paused") {
      await client.query(
        `UPDATE tenant_billing_accounts
         SET collection_status = 'paused',
             dunning_status = 'paused',
             updated_at = now()
         WHERE tenant_id = $1
           AND workspace_key = $2`,
        [input.tenantId, workspaceKey]
      );
    }

    await recordAuditLogWithClient(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "tenant_collection_event_recorded",
      entityType: "tenant_collection_event",
      entityId: event?.id ?? null,
      data: {
        workspaceKey,
        invoiceId: input.invoiceId ?? null,
        eventType: input.eventType,
        status: input.status ?? "pending"
      }
    });
    await completeBillingActionIdempotency(client, idempotencyRowId, event);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!event) {
    throw new Error("Collection event was not recorded.");
  }
  return event;
}

function invoiceLineFromRow(row: InvoiceLineRow): CustomerSafeInvoiceExport["invoice"]["lines"][number] {
  return {
    lineType: row.line_type,
    moduleKey: row.module_key,
    usageKind: row.usage_kind,
    description: row.description,
    quantity: toNumber(row.quantity),
    unitAmountCent: toInt(row.unit_amount_cent),
    amountCent: toInt(row.amount_cent),
    currency: row.currency
  };
}

export async function getCustomerSafeInvoiceExport(input: {
  tenantId: string;
  workspaceKey?: string;
  invoiceId: string;
}): Promise<CustomerSafeInvoiceExport> {
  const workspaceKey = input.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const invoiceResult = await db.query<InvoiceRow & { plan_id: string | null }>(
    `SELECT i.id,
            i.invoice_number,
            i.status,
            i.currency,
            i.period_start,
            i.period_end,
            i.subtotal_cent,
            i.usage_cent,
            i.adjustment_cent,
            i.tax_cent,
            i.total_cent,
            i.amount_due_cent,
            i.due_at,
            i.issued_at,
            i.paid_at,
            i.voided_at,
            i.created_at,
            COALESCE(s.plan_id, t.plan) AS plan_id
     FROM tenant_invoices i
     JOIN tenants t
       ON t.id = i.tenant_id
     LEFT JOIN tenant_subscriptions s
       ON s.id = i.subscription_id
      AND s.tenant_id = i.tenant_id
      AND s.workspace_key = i.workspace_key
     WHERE i.tenant_id = $1
       AND i.workspace_key = $2
       AND i.id = $3
     LIMIT 1`,
    [input.tenantId, workspaceKey, input.invoiceId]
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  const linesResult = await db.query<InvoiceLineRow>(
    `SELECT id,
            line_type,
            module_key,
            usage_kind,
            description,
            quantity,
            unit_amount_cent,
            amount_cent,
            currency
     FROM tenant_invoice_lines
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND invoice_id = $3
     ORDER BY created_at ASC, id ASC`,
    [input.tenantId, workspaceKey, input.invoiceId]
  );

  return {
    formatVersion: "workspace-invoice-export.v1",
    generatedAt: new Date().toISOString(),
    workspaceKey,
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      status: invoice.status,
      planId: invoice.plan_id ?? "standard",
      currency: invoice.currency,
      periodStart: requiredIso(invoice.period_start),
      periodEnd: requiredIso(invoice.period_end),
      dueAt: toIso(invoice.due_at),
      issuedAt: toIso(invoice.issued_at),
      paidAt: toIso(invoice.paid_at),
      subtotalCent: toInt(invoice.subtotal_cent),
      usageCent: toInt(invoice.usage_cent),
      adjustmentCent: toInt(invoice.adjustment_cent),
      taxCent: toInt(invoice.tax_cent),
      totalCent: toInt(invoice.total_cent),
      amountDueCent: toInt(invoice.amount_due_cent),
      lines: linesResult.rows.map(invoiceLineFromRow)
    }
  };
}
