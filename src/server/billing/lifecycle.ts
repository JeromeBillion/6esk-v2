import { randomUUID } from "crypto";
import { db } from "@/server/db";
import {
  buildWorkspaceBillingQuote,
  type WorkspaceBillingQuoteLine
} from "@/server/billing/catalog";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";
import {
  DEFAULT_WORKSPACE_MODULES,
  normalizeWorkspaceModules,
  type WorkspaceModuleFlags,
  type WorkspaceModuleKey,
  type WorkspaceModuleStatus
} from "@/server/workspace-modules";

type QueryResult<T extends Record<string, unknown> = Record<string, unknown>> = {
  rows: T[];
  rowCount?: number | null;
};

type BillingQueryTarget = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<QueryResult<T>>;
};

type BillingDbClient = BillingQueryTarget & {
  release: () => void;
};

export type BillingSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "grace_period"
  | "downgrade_pending"
  | "suspended"
  | "canceled"
  | "written_off";

export type BillingCollectionStatus =
  | "current"
  | "retrying"
  | "grace_period"
  | "overdue"
  | "suspended"
  | "restored"
  | "written_off";

export type BillingPlanChangeType =
  | "upgrade"
  | "downgrade"
  | "module_change"
  | "cancel"
  | "reactivate";

export type BillingPlanChangeStatus = "scheduled" | "applied" | "canceled";

export type BillingAdjustmentType = "credit" | "refund" | "write_off" | "plan_override";

export type BillingInvoiceStatus =
  | "draft"
  | "issued"
  | "paid"
  | "void"
  | "credited"
  | "refunded"
  | "overdue"
  | "written_off";

export type BillingDunningEventType =
  | "retry_scheduled"
  | "grace_period_started"
  | "overdue"
  | "suspended"
  | "restored"
  | "written_off";

export type BillingActor = {
  userId?: string | null;
};

export type WorkspaceBillingSubscription = {
  id: string;
  tenantKey: string;
  workspaceKey: string;
  planKey: string;
  catalogVersion: string;
  status: BillingSubscriptionStatus;
  collectionStatus: BillingCollectionStatus;
  modules: WorkspaceModuleFlags;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  renewsAt: string | null;
  cancelAt: string | null;
  canceledAt: string | null;
  downgradeAt: string | null;
  suspendedAt: string | null;
  gracePeriodEndsAt: string | null;
  providerCustomerRef: string | null;
  providerSubscriptionRef: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BillingProrationCalculation = {
  catalogVersion: string;
  currency: "ZAR";
  periodStart: string;
  periodEnd: string;
  effectiveAt: string;
  remainingRatio: number;
  fromSubtotalCents: number;
  toSubtotalCents: number;
  subtotalDeltaCents: number;
  vatRatePercent: number;
  vatDeltaCents: number;
  totalDeltaCents: number;
  prorationCents: number;
  creditCents: number;
  chargeCents: number;
  lineDeltas: Array<{
    sku: string;
    label: string;
    fromSubtotalCents: number;
    toSubtotalCents: number;
    deltaCents: number;
  }>;
};

export type WorkspaceBillingPlanChange = {
  id: string;
  tenantKey: string;
  workspaceKey: string;
  subscriptionId: string;
  changeType: BillingPlanChangeType;
  status: BillingPlanChangeStatus;
  fromPlanKey: string;
  toPlanKey: string;
  fromModules: WorkspaceModuleFlags;
  toModules: WorkspaceModuleFlags;
  effectiveAt: string;
  periodStart: string;
  periodEnd: string;
  subtotalDeltaCents: number;
  vatDeltaCents: number;
  totalDeltaCents: number;
  prorationCents: number;
  creditCents: number;
  chargeCents: number;
  currency: "ZAR";
  calculation: BillingProrationCalculation;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceBillingInvoiceLine = {
  sku: string;
  label: string;
  description: string;
  quantity: number;
  unitAmountCents: number;
  subtotalCents: number;
};

export type WorkspaceBillingInvoice = {
  id: string;
  tenantKey: string;
  workspaceKey: string;
  subscriptionId: string;
  invoiceNumber: string | null;
  status: BillingInvoiceStatus;
  currency: "ZAR";
  periodStart: string;
  periodEnd: string;
  dueAt: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  creditedAt: string | null;
  refundedAt: string | null;
  writtenOffAt: string | null;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  amountCreditedCents: number;
  amountRefundedCents: number;
  amountWrittenOffCents: number;
  lines: WorkspaceBillingInvoiceLine[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceBillingAdjustment = {
  id: string;
  tenantKey: string;
  workspaceKey: string;
  subscriptionId: string;
  invoiceId: string | null;
  adjustmentType: BillingAdjustmentType;
  status: "applied" | "void";
  amountCents: number;
  currency: "ZAR";
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  voidedAt: string | null;
};

export type WorkspaceBillingDunningEvent = {
  id: string;
  tenantKey: string;
  workspaceKey: string;
  subscriptionId: string;
  invoiceId: string | null;
  eventType: BillingDunningEventType;
  fromCollectionStatus: BillingCollectionStatus | null;
  toCollectionStatus: BillingCollectionStatus;
  reason: string | null;
  retryAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceBillingOverview = {
  subscription: WorkspaceBillingSubscription | null;
  planChanges: WorkspaceBillingPlanChange[];
  invoices: WorkspaceBillingInvoice[];
  adjustments: WorkspaceBillingAdjustment[];
  dunningEvents: WorkspaceBillingDunningEvent[];
};

type SubscriptionRow = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  plan_key: string;
  catalog_version: string;
  status: BillingSubscriptionStatus;
  collection_status: BillingCollectionStatus;
  modules: Partial<Record<WorkspaceModuleKey, unknown>> | null;
  current_period_start: Date | string;
  current_period_end: Date | string;
  renews_at: Date | string | null;
  cancel_at: Date | string | null;
  canceled_at: Date | string | null;
  downgrade_at: Date | string | null;
  suspended_at: Date | string | null;
  grace_period_ends_at: Date | string | null;
  provider_customer_ref: string | null;
  provider_subscription_ref: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PlanChangeRow = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  subscription_id: string;
  change_type: BillingPlanChangeType;
  status: BillingPlanChangeStatus;
  from_plan_key: string;
  to_plan_key: string;
  from_modules: Partial<Record<WorkspaceModuleKey, unknown>> | null;
  to_modules: Partial<Record<WorkspaceModuleKey, unknown>> | null;
  effective_at: Date | string;
  period_start: Date | string;
  period_end: Date | string;
  subtotal_delta_cents: number;
  vat_delta_cents: number;
  total_delta_cents: number;
  proration_cents: number;
  credit_cents: number;
  charge_cents: number;
  currency: "ZAR";
  calculation: BillingProrationCalculation | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type InvoiceRow = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  subscription_id: string;
  invoice_number: string | null;
  status: BillingInvoiceStatus;
  currency: "ZAR";
  period_start: Date | string;
  period_end: Date | string;
  due_at: Date | string | null;
  issued_at: Date | string | null;
  paid_at: Date | string | null;
  voided_at: Date | string | null;
  credited_at: Date | string | null;
  refunded_at: Date | string | null;
  written_off_at: Date | string | null;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  amount_due_cents: number;
  amount_paid_cents: number;
  amount_credited_cents: number;
  amount_refunded_cents: number;
  amount_written_off_cents: number;
  lines: unknown;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type AdjustmentRow = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  subscription_id: string;
  invoice_id: string | null;
  adjustment_type: BillingAdjustmentType;
  status: "applied" | "void";
  amount_cents: number;
  currency: "ZAR";
  reason: string;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  voided_at: Date | string | null;
};

type DunningEventRow = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  subscription_id: string;
  invoice_id: string | null;
  event_type: BillingDunningEventType;
  from_collection_status: BillingCollectionStatus | null;
  to_collection_status: BillingCollectionStatus;
  reason: string | null;
  retry_at: Date | string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
};

const INVOICE_TRANSITIONS: Record<BillingInvoiceStatus, BillingInvoiceStatus[]> = {
  draft: ["issued", "void"],
  issued: ["paid", "overdue", "void", "credited", "written_off"],
  paid: ["credited", "refunded"],
  void: [],
  credited: ["refunded"],
  refunded: [],
  overdue: ["paid", "credited", "written_off", "void"],
  written_off: []
};

const BILLABLE_MODULES = new Set<WorkspaceModuleKey>(["whatsapp", "voice", "aiAutomation"]);

function asDate(value: Date | string, fieldName: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} is not a valid date.`);
  }
  return date;
}

function optionalIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return asDate(value, "date").toISOString();
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function cents(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function positiveCents(value: number, fieldName: string) {
  const normalized = cents(value);
  if (normalized <= 0) {
    throw new Error(`${fieldName} must be a positive cent amount.`);
  }
  return normalized;
}

function safeJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRatio(value: number) {
  return Number.parseFloat(value.toFixed(6));
}

function modulesEqual(left: WorkspaceModuleFlags, right: WorkspaceModuleFlags) {
  return (Object.keys(DEFAULT_WORKSPACE_MODULES) as WorkspaceModuleKey[]).every(
    (key) => left[key] === right[key]
  );
}

function mapSubscription(row: SubscriptionRow): WorkspaceBillingSubscription {
  return {
    id: row.id,
    tenantKey: row.tenant_key,
    workspaceKey: row.workspace_key,
    planKey: row.plan_key,
    catalogVersion: row.catalog_version,
    status: row.status,
    collectionStatus: row.collection_status,
    modules: normalizeWorkspaceModules(row.modules),
    currentPeriodStart: asDate(row.current_period_start, "current_period_start").toISOString(),
    currentPeriodEnd: asDate(row.current_period_end, "current_period_end").toISOString(),
    renewsAt: optionalIso(row.renews_at),
    cancelAt: optionalIso(row.cancel_at),
    canceledAt: optionalIso(row.canceled_at),
    downgradeAt: optionalIso(row.downgrade_at),
    suspendedAt: optionalIso(row.suspended_at),
    gracePeriodEndsAt: optionalIso(row.grace_period_ends_at),
    providerCustomerRef: row.provider_customer_ref,
    providerSubscriptionRef: row.provider_subscription_ref,
    metadata: safeJson(row.metadata),
    createdAt: asDate(row.created_at, "created_at").toISOString(),
    updatedAt: asDate(row.updated_at, "updated_at").toISOString()
  };
}

function mapPlanChange(row: PlanChangeRow): WorkspaceBillingPlanChange {
  return {
    id: row.id,
    tenantKey: row.tenant_key,
    workspaceKey: row.workspace_key,
    subscriptionId: row.subscription_id,
    changeType: row.change_type,
    status: row.status,
    fromPlanKey: row.from_plan_key,
    toPlanKey: row.to_plan_key,
    fromModules: normalizeWorkspaceModules(row.from_modules),
    toModules: normalizeWorkspaceModules(row.to_modules),
    effectiveAt: asDate(row.effective_at, "effective_at").toISOString(),
    periodStart: asDate(row.period_start, "period_start").toISOString(),
    periodEnd: asDate(row.period_end, "period_end").toISOString(),
    subtotalDeltaCents: cents(row.subtotal_delta_cents),
    vatDeltaCents: cents(row.vat_delta_cents),
    totalDeltaCents: cents(row.total_delta_cents),
    prorationCents: cents(row.proration_cents),
    creditCents: cents(row.credit_cents),
    chargeCents: cents(row.charge_cents),
    currency: "ZAR",
    calculation: row.calculation as BillingProrationCalculation,
    metadata: safeJson(row.metadata),
    createdAt: asDate(row.created_at, "created_at").toISOString(),
    updatedAt: asDate(row.updated_at, "updated_at").toISOString()
  };
}

function normalizeInvoiceLines(value: unknown): WorkspaceBillingInvoiceLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((line) => {
      if (!line || typeof line !== "object") return null;
      const record = line as Record<string, unknown>;
      const sku = typeof record.sku === "string" ? record.sku : "";
      const label = typeof record.label === "string" ? record.label : "";
      const description = typeof record.description === "string" ? record.description : "";
      if (!sku || !label) return null;
      return {
        sku,
        label,
        description,
        quantity: cents(record.quantity),
        unitAmountCents: cents(record.unitAmountCents ?? record.unit_amount_cents),
        subtotalCents: cents(record.subtotalCents ?? record.subtotal_cents)
      };
    })
    .filter((line): line is WorkspaceBillingInvoiceLine => Boolean(line));
}

function mapInvoice(row: InvoiceRow): WorkspaceBillingInvoice {
  return {
    id: row.id,
    tenantKey: row.tenant_key,
    workspaceKey: row.workspace_key,
    subscriptionId: row.subscription_id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    currency: "ZAR",
    periodStart: asDate(row.period_start, "period_start").toISOString(),
    periodEnd: asDate(row.period_end, "period_end").toISOString(),
    dueAt: optionalIso(row.due_at),
    issuedAt: optionalIso(row.issued_at),
    paidAt: optionalIso(row.paid_at),
    voidedAt: optionalIso(row.voided_at),
    creditedAt: optionalIso(row.credited_at),
    refundedAt: optionalIso(row.refunded_at),
    writtenOffAt: optionalIso(row.written_off_at),
    subtotalCents: cents(row.subtotal_cents),
    vatCents: cents(row.vat_cents),
    totalCents: cents(row.total_cents),
    amountDueCents: cents(row.amount_due_cents),
    amountPaidCents: cents(row.amount_paid_cents),
    amountCreditedCents: cents(row.amount_credited_cents),
    amountRefundedCents: cents(row.amount_refunded_cents),
    amountWrittenOffCents: cents(row.amount_written_off_cents),
    lines: normalizeInvoiceLines(row.lines),
    metadata: safeJson(row.metadata),
    createdAt: asDate(row.created_at, "created_at").toISOString(),
    updatedAt: asDate(row.updated_at, "updated_at").toISOString()
  };
}

function mapAdjustment(row: AdjustmentRow): WorkspaceBillingAdjustment {
  return {
    id: row.id,
    tenantKey: row.tenant_key,
    workspaceKey: row.workspace_key,
    subscriptionId: row.subscription_id,
    invoiceId: row.invoice_id,
    adjustmentType: row.adjustment_type,
    status: row.status,
    amountCents: cents(row.amount_cents),
    currency: "ZAR",
    reason: row.reason,
    metadata: safeJson(row.metadata),
    createdAt: asDate(row.created_at, "created_at").toISOString(),
    voidedAt: optionalIso(row.voided_at)
  };
}

function mapDunningEvent(row: DunningEventRow): WorkspaceBillingDunningEvent {
  return {
    id: row.id,
    tenantKey: row.tenant_key,
    workspaceKey: row.workspace_key,
    subscriptionId: row.subscription_id,
    invoiceId: row.invoice_id,
    eventType: row.event_type,
    fromCollectionStatus: row.from_collection_status,
    toCollectionStatus: row.to_collection_status,
    reason: row.reason,
    retryAt: optionalIso(row.retry_at),
    metadata: safeJson(row.metadata),
    createdAt: asDate(row.created_at, "created_at").toISOString()
  };
}

function invoiceLinesFromQuote(lines: WorkspaceBillingQuoteLine[]): WorkspaceBillingInvoiceLine[] {
  return lines
    .filter((line) => line.enabled)
    .map((line) => ({
      sku: line.sku,
      label: line.label,
      description: line.description,
      quantity: line.quantity,
      unitAmountCents: line.unitAmountCents,
      subtotalCents: line.subtotalCents
    }));
}

function invoiceNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${stamp}-${randomUUID().slice(0, 8)}`.toUpperCase();
}

async function withTransaction<T>(operation: (target: BillingQueryTarget) => Promise<T>) {
  const client = (await db.connect()) as BillingDbClient;
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recordBillingAudit(
  target: BillingQueryTarget,
  input: {
    tenantKey: string;
    workspaceKey: string;
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    data?: Record<string, unknown> | null;
  }
) {
  await target.query(
    `INSERT INTO audit_logs (tenant_key, workspace_key, actor_user_id, action, entity_type, entity_id, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.tenantKey,
      input.workspaceKey,
      input.actorUserId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.data ? JSON.stringify(input.data) : null
    ]
  );
}

function entitlementStatusForSubscription(
  subscription: Pick<WorkspaceBillingSubscription, "status" | "collectionStatus">
): WorkspaceModuleStatus {
  if (
    subscription.status === "suspended" ||
    subscription.status === "canceled" ||
    subscription.status === "written_off" ||
    subscription.collectionStatus === "suspended" ||
    subscription.collectionStatus === "written_off"
  ) {
    return "suspended";
  }
  if (subscription.status === "downgrade_pending") return "downgrade_pending";
  return "active";
}

function entitlementSnapshot(subscription: WorkspaceBillingSubscription) {
  const status = entitlementStatusForSubscription(subscription);
  return (Object.keys(DEFAULT_WORKSPACE_MODULES) as WorkspaceModuleKey[]).reduce(
    (snapshot, moduleKey) => {
      const configured = subscription.modules[moduleKey] === true;
      const moduleStatus = configured ? status : "disabled";
      snapshot[moduleKey] = {
        enabled: configured && moduleStatus !== "suspended" && moduleStatus !== "disabled",
        status: moduleStatus,
        planKey: subscription.planKey,
        billingMode: BILLABLE_MODULES.has(moduleKey) ? "billable" : "included",
        reason:
          moduleStatus === "suspended"
            ? `billing_${subscription.collectionStatus || subscription.status}`
            : null,
        effectiveAt: new Date().toISOString()
      };
      return snapshot;
    },
    {} as Record<WorkspaceModuleKey, Record<string, unknown>>
  );
}

async function syncWorkspaceModuleEntitlements(
  target: BillingQueryTarget,
  subscription: WorkspaceBillingSubscription
) {
  await target.query(
    `INSERT INTO workspace_modules (tenant_key, workspace_key, modules, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (tenant_key, workspace_key)
     DO UPDATE SET modules = EXCLUDED.modules, updated_at = now()`,
    [
      subscription.tenantKey,
      subscription.workspaceKey,
      JSON.stringify(entitlementSnapshot(subscription))
    ]
  );
}

async function selectSubscriptionForUpdate(
  target: BillingQueryTarget,
  tenantKey: string,
  workspaceKey: string,
  subscriptionId?: string | null
) {
  const result = await target.query<SubscriptionRow>(
    `SELECT *
       FROM workspace_billing_subscriptions
      WHERE tenant_key = $1
        AND workspace_key = $2
        AND ($3::uuid IS NULL OR id = $3::uuid)
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [tenantKey, workspaceKey, subscriptionId ?? null]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Billing subscription was not found for this tenant workspace.");
  }
  return mapSubscription(row);
}

function subscriptionStatusFromCollection(status: BillingCollectionStatus): BillingSubscriptionStatus {
  if (status === "current" || status === "restored") return "active";
  if (status === "retrying" || status === "overdue") return "past_due";
  if (status === "grace_period") return "grace_period";
  if (status === "suspended") return "suspended";
  return "written_off";
}

function dunningEventTypeForCollection(status: BillingCollectionStatus): BillingDunningEventType {
  if (status === "retrying") return "retry_scheduled";
  if (status === "grace_period") return "grace_period_started";
  if (status === "overdue") return "overdue";
  if (status === "suspended") return "suspended";
  if (status === "restored" || status === "current") return "restored";
  return "written_off";
}

function assertAllowedInvoiceTransition(from: BillingInvoiceStatus, to: BillingInvoiceStatus) {
  if (from === to) return;
  if (!INVOICE_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invoice cannot transition from ${from} to ${to}.`);
  }
}

export function calculatePlanChangeProration(input: {
  fromModules: Partial<WorkspaceModuleFlags>;
  toModules: Partial<WorkspaceModuleFlags>;
  periodStart: Date | string;
  periodEnd: Date | string;
  effectiveAt: Date | string;
  vatRatePercent?: number;
}): BillingProrationCalculation {
  const periodStart = asDate(input.periodStart, "periodStart");
  const periodEnd = asDate(input.periodEnd, "periodEnd");
  const effectiveAt = asDate(input.effectiveAt, "effectiveAt");
  if (periodEnd <= periodStart) {
    throw new Error("periodEnd must be after periodStart.");
  }

  const fromModules = normalizeWorkspaceModules(input.fromModules);
  const toModules = normalizeWorkspaceModules(input.toModules);
  const fromQuote = buildWorkspaceBillingQuote(fromModules, {
    vatRatePercent: input.vatRatePercent
  });
  const toQuote = buildWorkspaceBillingQuote(toModules, {
    vatRatePercent: input.vatRatePercent
  });
  const totalMs = periodEnd.getTime() - periodStart.getTime();
  const remainingMs = clamp(periodEnd.getTime() - effectiveAt.getTime(), 0, totalMs);
  const remainingRatio = remainingMs / totalMs;
  const subtotalDeltaCents = toQuote.subtotalCents - fromQuote.subtotalCents;
  const vatDeltaCents = Math.round(subtotalDeltaCents * (fromQuote.vatRatePercent / 100));
  const totalDeltaCents = subtotalDeltaCents + vatDeltaCents;
  const prorationCents = Math.round(totalDeltaCents * remainingRatio);

  const toLineMap = new Map(toQuote.lines.map((line) => [line.sku, line]));
  const fromLineMap = new Map(fromQuote.lines.map((line) => [line.sku, line]));
  const lineSkus = [...new Set([...fromLineMap.keys(), ...toLineMap.keys()])].sort();

  return {
    catalogVersion: fromQuote.catalogVersion,
    currency: "ZAR",
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    effectiveAt: effectiveAt.toISOString(),
    remainingRatio: normalizeRatio(remainingRatio),
    fromSubtotalCents: fromQuote.subtotalCents,
    toSubtotalCents: toQuote.subtotalCents,
    subtotalDeltaCents,
    vatRatePercent: fromQuote.vatRatePercent,
    vatDeltaCents,
    totalDeltaCents,
    prorationCents,
    creditCents: Math.max(0, -prorationCents),
    chargeCents: Math.max(0, prorationCents),
    lineDeltas: lineSkus.map((sku) => {
      const fromLine = fromLineMap.get(sku);
      const toLine = toLineMap.get(sku);
      return {
        sku,
        label: toLine?.label ?? fromLine?.label ?? sku,
        fromSubtotalCents: fromLine?.subtotalCents ?? 0,
        toSubtotalCents: toLine?.subtotalCents ?? 0,
        deltaCents: (toLine?.subtotalCents ?? 0) - (fromLine?.subtotalCents ?? 0)
      };
    })
  };
}

export async function ensureWorkspaceBillingSubscription(input: {
  tenantKey?: string;
  workspaceKey?: string;
  actor?: BillingActor | null;
  planKey?: string;
  modules?: Partial<WorkspaceModuleFlags>;
  status?: BillingSubscriptionStatus;
  collectionStatus?: BillingCollectionStatus;
  currentPeriodStart?: Date | string;
  currentPeriodEnd?: Date | string;
  metadata?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope(input);
  const now = new Date();
  const periodStart = input.currentPeriodStart
    ? asDate(input.currentPeriodStart, "currentPeriodStart")
    : now;
  const periodEnd = input.currentPeriodEnd
    ? asDate(input.currentPeriodEnd, "currentPeriodEnd")
    : addMonths(periodStart, 1);
  const modules = normalizeWorkspaceModules(input.modules ?? DEFAULT_WORKSPACE_MODULES);
  const planKey = input.planKey?.trim() || "core_os";

  return withTransaction(async (target) => {
    const result = await target.query<SubscriptionRow>(
      `INSERT INTO workspace_billing_subscriptions (
         tenant_key,
         workspace_key,
         plan_key,
         modules,
         status,
         collection_status,
         current_period_start,
         current_period_end,
         renews_at,
         created_by_user_id,
         updated_by_user_id,
         metadata
       )
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $8, $9, $9, $10::jsonb)
       ON CONFLICT (tenant_key, workspace_key)
       DO UPDATE SET
         plan_key = EXCLUDED.plan_key,
         modules = EXCLUDED.modules,
         status = EXCLUDED.status,
         collection_status = EXCLUDED.collection_status,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         renews_at = EXCLUDED.renews_at,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         metadata = workspace_billing_subscriptions.metadata || EXCLUDED.metadata,
         updated_at = now()
       RETURNING *`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        planKey,
        JSON.stringify(modules),
        input.status ?? "active",
        input.collectionStatus ?? "current",
        periodStart,
        periodEnd,
        input.actor?.userId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    const subscription = mapSubscription(result.rows[0]);
    await syncWorkspaceModuleEntitlements(target, subscription);
    await recordBillingAudit(target, {
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: input.actor?.userId,
      action: "billing_subscription_upserted",
      entityType: "workspace_billing_subscriptions",
      entityId: subscription.id,
      data: {
        planKey: subscription.planKey,
        status: subscription.status,
        collectionStatus: subscription.collectionStatus
      }
    });
    return subscription;
  });
}

export async function getWorkspaceBillingOverview(
  input?: TenantScopeInput
): Promise<WorkspaceBillingOverview> {
  const scope = resolveTenantScope(input);
  const subscriptionResult = await db.query<SubscriptionRow>(
    `SELECT *
       FROM workspace_billing_subscriptions
      WHERE tenant_key = $1
        AND workspace_key = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [scope.tenantKey, scope.workspaceKey]
  );
  const subscription = subscriptionResult.rows[0] ? mapSubscription(subscriptionResult.rows[0]) : null;

  const [planChanges, invoices, adjustments, dunningEvents] = await Promise.all([
    db.query<PlanChangeRow>(
      `SELECT *
         FROM workspace_billing_plan_changes
        WHERE tenant_key = $1
          AND workspace_key = $2
        ORDER BY created_at DESC
        LIMIT 25`,
      [scope.tenantKey, scope.workspaceKey]
    ),
    db.query<InvoiceRow>(
      `SELECT *
         FROM workspace_billing_invoices
        WHERE tenant_key = $1
          AND workspace_key = $2
        ORDER BY created_at DESC
        LIMIT 25`,
      [scope.tenantKey, scope.workspaceKey]
    ),
    db.query<AdjustmentRow>(
      `SELECT *
         FROM workspace_billing_adjustments
        WHERE tenant_key = $1
          AND workspace_key = $2
        ORDER BY created_at DESC
        LIMIT 25`,
      [scope.tenantKey, scope.workspaceKey]
    ),
    db.query<DunningEventRow>(
      `SELECT *
         FROM workspace_billing_dunning_events
        WHERE tenant_key = $1
          AND workspace_key = $2
        ORDER BY created_at DESC
        LIMIT 25`,
      [scope.tenantKey, scope.workspaceKey]
    )
  ]);

  return {
    subscription,
    planChanges: planChanges.rows.map(mapPlanChange),
    invoices: invoices.rows.map(mapInvoice),
    adjustments: adjustments.rows.map(mapAdjustment),
    dunningEvents: dunningEvents.rows.map(mapDunningEvent)
  };
}

export async function updateBillingSubscriptionLifecycle(input: {
  tenantKey?: string;
  workspaceKey?: string;
  actor?: BillingActor | null;
  subscriptionId?: string | null;
  status: BillingSubscriptionStatus;
  collectionStatus?: BillingCollectionStatus;
  modules?: Partial<WorkspaceModuleFlags> | null;
  cancelAt?: Date | string | null;
  downgradeAt?: Date | string | null;
  suspendedAt?: Date | string | null;
  gracePeriodEndsAt?: Date | string | null;
  reason: string;
  metadata?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope(input);
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("A subscription lifecycle reason is required.");
  }

  return withTransaction(async (target) => {
    const current = await selectSubscriptionForUpdate(
      target,
      scope.tenantKey,
      scope.workspaceKey,
      input.subscriptionId
    );
    const modules = input.modules ? normalizeWorkspaceModules(input.modules) : current.modules;
    const nextCollectionStatus =
      input.collectionStatus ??
      (input.status === "suspended" || input.status === "canceled"
        ? "suspended"
        : input.status === "written_off"
          ? "written_off"
          : input.status === "past_due"
            ? "overdue"
            : current.collectionStatus);
    const cancelAt = input.cancelAt ? asDate(input.cancelAt, "cancelAt") : null;
    const downgradeAt = input.downgradeAt ? asDate(input.downgradeAt, "downgradeAt") : null;
    const suspendedAt = input.suspendedAt ? asDate(input.suspendedAt, "suspendedAt") : null;
    const gracePeriodEndsAt = input.gracePeriodEndsAt
      ? asDate(input.gracePeriodEndsAt, "gracePeriodEndsAt")
      : null;

    const result = await target.query<SubscriptionRow>(
      `UPDATE workspace_billing_subscriptions
          SET status = $4,
              collection_status = $5,
              modules = $6::jsonb,
              cancel_at = CASE WHEN $7::timestamptz IS NULL THEN cancel_at ELSE $7::timestamptz END,
              canceled_at = CASE WHEN $4 = 'canceled' THEN COALESCE(canceled_at, now()) ELSE canceled_at END,
              downgrade_at = CASE WHEN $8::timestamptz IS NULL THEN downgrade_at ELSE $8::timestamptz END,
              suspended_at = CASE WHEN $4 = 'suspended' THEN COALESCE($9::timestamptz, suspended_at, now()) ELSE suspended_at END,
              grace_period_ends_at = CASE WHEN $10::timestamptz IS NULL THEN grace_period_ends_at ELSE $10::timestamptz END,
              updated_by_user_id = $11,
              metadata = metadata || $12::jsonb,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
          AND id = $3
        RETURNING *`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        current.id,
        input.status,
        nextCollectionStatus,
        JSON.stringify(modules),
        cancelAt,
        downgradeAt,
        suspendedAt,
        gracePeriodEndsAt,
        input.actor?.userId ?? null,
        JSON.stringify({ ...(input.metadata ?? {}), lastLifecycleReason: reason })
      ]
    );
    const subscription = mapSubscription(result.rows[0]);
    await syncWorkspaceModuleEntitlements(target, subscription);
    await recordBillingAudit(target, {
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: input.actor?.userId,
      action: "billing_subscription_lifecycle_changed",
      entityType: "workspace_billing_subscriptions",
      entityId: subscription.id,
      data: {
        fromStatus: current.status,
        toStatus: subscription.status,
        fromCollectionStatus: current.collectionStatus,
        toCollectionStatus: subscription.collectionStatus,
        reason
      }
    });
    return subscription;
  });
}

export async function recordBillingPlanChange(input: {
  tenantKey?: string;
  workspaceKey?: string;
  actor?: BillingActor | null;
  subscriptionId?: string | null;
  toPlanKey?: string;
  toModules: Partial<WorkspaceModuleFlags>;
  effectiveAt?: Date | string;
  changeType?: BillingPlanChangeType;
  metadata?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope(input);
  const effectiveAt = input.effectiveAt ? asDate(input.effectiveAt, "effectiveAt") : new Date();
  const toModules = normalizeWorkspaceModules(input.toModules);

  return withTransaction(async (target) => {
    const subscription = await selectSubscriptionForUpdate(
      target,
      scope.tenantKey,
      scope.workspaceKey,
      input.subscriptionId
    );
    const calculation = calculatePlanChangeProration({
      fromModules: subscription.modules,
      toModules,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      effectiveAt
    });
    const toPlanKey = input.toPlanKey?.trim() || subscription.planKey;
    const inferredType: BillingPlanChangeType =
      input.changeType ??
      (calculation.chargeCents > 0
        ? "upgrade"
        : calculation.creditCents > 0
          ? "downgrade"
          : modulesEqual(subscription.modules, toModules)
            ? "module_change"
            : "module_change");
    const appliesNow = effectiveAt.getTime() <= Date.now();
    const status: BillingPlanChangeStatus = appliesNow ? "applied" : "scheduled";

    const result = await target.query<PlanChangeRow>(
      `INSERT INTO workspace_billing_plan_changes (
         tenant_key,
         workspace_key,
         subscription_id,
         change_type,
         status,
         from_plan_key,
         to_plan_key,
         from_modules,
         to_modules,
         effective_at,
         period_start,
         period_end,
         subtotal_delta_cents,
         vat_delta_cents,
         total_delta_cents,
         proration_cents,
         credit_cents,
         charge_cents,
         currency,
         calculation,
         requested_by_user_id,
         applied_by_user_id,
         metadata
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, 'ZAR', $19::jsonb, $20, $21, $22::jsonb
       )
       RETURNING *`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        subscription.id,
        inferredType,
        status,
        subscription.planKey,
        toPlanKey,
        JSON.stringify(subscription.modules),
        JSON.stringify(toModules),
        effectiveAt,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
        calculation.subtotalDeltaCents,
        calculation.vatDeltaCents,
        calculation.totalDeltaCents,
        calculation.prorationCents,
        calculation.creditCents,
        calculation.chargeCents,
        JSON.stringify(calculation),
        input.actor?.userId ?? null,
        status === "applied" ? input.actor?.userId ?? null : null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    const change = mapPlanChange(result.rows[0]);

    let nextSubscription = subscription;
    if (status === "applied") {
      const updated = await target.query<SubscriptionRow>(
        `UPDATE workspace_billing_subscriptions
            SET plan_key = $4,
                modules = $5::jsonb,
                status = 'active',
                downgrade_at = NULL,
                updated_by_user_id = $6,
                updated_at = now()
          WHERE tenant_key = $1
            AND workspace_key = $2
            AND id = $3
          RETURNING *`,
        [
          scope.tenantKey,
          scope.workspaceKey,
          subscription.id,
          toPlanKey,
          JSON.stringify(toModules),
          input.actor?.userId ?? null
        ]
      );
      nextSubscription = mapSubscription(updated.rows[0]);
      await syncWorkspaceModuleEntitlements(target, nextSubscription);
    } else if (inferredType === "downgrade") {
      const updated = await target.query<SubscriptionRow>(
        `UPDATE workspace_billing_subscriptions
            SET status = 'downgrade_pending',
                downgrade_at = $4,
                updated_by_user_id = $5,
                updated_at = now()
          WHERE tenant_key = $1
            AND workspace_key = $2
            AND id = $3
          RETURNING *`,
        [
          scope.tenantKey,
          scope.workspaceKey,
          subscription.id,
          effectiveAt,
          input.actor?.userId ?? null
        ]
      );
      nextSubscription = mapSubscription(updated.rows[0]);
      await syncWorkspaceModuleEntitlements(target, nextSubscription);
    }

    await recordBillingAudit(target, {
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: input.actor?.userId,
      action: "billing_plan_change_recorded",
      entityType: "workspace_billing_plan_changes",
      entityId: change.id,
      data: {
        subscriptionId: subscription.id,
        status: change.status,
        changeType: change.changeType,
        creditCents: change.creditCents,
        chargeCents: change.chargeCents
      }
    });

    return { change, subscription: nextSubscription };
  });
}

export async function createWorkspaceBillingInvoice(input: {
  tenantKey?: string;
  workspaceKey?: string;
  actor?: BillingActor | null;
  subscriptionId?: string | null;
  periodStart?: Date | string;
  periodEnd?: Date | string;
  dueAt?: Date | string | null;
  status?: "draft" | "issued";
  metadata?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope(input);

  return withTransaction(async (target) => {
    const subscription = await selectSubscriptionForUpdate(
      target,
      scope.tenantKey,
      scope.workspaceKey,
      input.subscriptionId
    );
    const periodStart = input.periodStart
      ? asDate(input.periodStart, "periodStart")
      : asDate(subscription.currentPeriodStart, "currentPeriodStart");
    const periodEnd = input.periodEnd
      ? asDate(input.periodEnd, "periodEnd")
      : asDate(subscription.currentPeriodEnd, "currentPeriodEnd");
    const quote = buildWorkspaceBillingQuote(subscription.modules);
    const status = input.status ?? "draft";
    const dueAt = input.dueAt ? asDate(input.dueAt, "dueAt") : null;

    const result = await target.query<InvoiceRow>(
      `INSERT INTO workspace_billing_invoices (
         tenant_key,
         workspace_key,
         subscription_id,
         invoice_number,
         status,
         currency,
         period_start,
         period_end,
         due_at,
         issued_at,
         subtotal_cents,
         vat_cents,
         total_cents,
         amount_due_cents,
         lines,
         metadata,
         created_by_user_id,
         updated_by_user_id
       )
       VALUES (
         $1, $2, $3, $4, $5, 'ZAR', $6, $7, $8, CASE WHEN $5 = 'issued' THEN now() ELSE NULL END,
         $9, $10, $11, $11, $12::jsonb, $13::jsonb, $14, $14
       )
       RETURNING *`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        subscription.id,
        invoiceNumber(),
        status,
        periodStart,
        periodEnd,
        dueAt,
        quote.subtotalCents,
        quote.vatCents,
        quote.totalCents,
        JSON.stringify(invoiceLinesFromQuote(quote.lines)),
        JSON.stringify(input.metadata ?? {}),
        input.actor?.userId ?? null
      ]
    );
    const invoice = mapInvoice(result.rows[0]);
    await recordBillingAudit(target, {
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: input.actor?.userId,
      action: "billing_invoice_created",
      entityType: "workspace_billing_invoices",
      entityId: invoice.id,
      data: {
        subscriptionId: subscription.id,
        status: invoice.status,
        totalCents: invoice.totalCents,
        lineCount: invoice.lines.length
      }
    });
    return invoice;
  });
}

export async function transitionWorkspaceBillingInvoice(input: {
  tenantKey?: string;
  workspaceKey?: string;
  actor?: BillingActor | null;
  invoiceId: string;
  status: BillingInvoiceStatus;
  reason?: string | null;
}) {
  const scope = resolveTenantScope(input);

  return withTransaction(async (target) => {
    const currentResult = await target.query<InvoiceRow>(
      `SELECT *
         FROM workspace_billing_invoices
        WHERE tenant_key = $1
          AND workspace_key = $2
          AND id = $3
        LIMIT 1
        FOR UPDATE`,
      [scope.tenantKey, scope.workspaceKey, input.invoiceId]
    );
    const current = currentResult.rows[0] ? mapInvoice(currentResult.rows[0]) : null;
    if (!current) {
      throw new Error("Billing invoice was not found for this tenant workspace.");
    }
    assertAllowedInvoiceTransition(current.status, input.status);

    const result = await target.query<InvoiceRow>(
      `UPDATE workspace_billing_invoices
          SET status = $4,
              issued_at = CASE WHEN $4 = 'issued' THEN COALESCE(issued_at, now()) ELSE issued_at END,
              paid_at = CASE WHEN $4 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
              voided_at = CASE WHEN $4 = 'void' THEN COALESCE(voided_at, now()) ELSE voided_at END,
              credited_at = CASE WHEN $4 = 'credited' THEN COALESCE(credited_at, now()) ELSE credited_at END,
              refunded_at = CASE WHEN $4 = 'refunded' THEN COALESCE(refunded_at, now()) ELSE refunded_at END,
              written_off_at = CASE WHEN $4 = 'written_off' THEN COALESCE(written_off_at, now()) ELSE written_off_at END,
              amount_paid_cents = CASE WHEN $4 = 'paid' THEN GREATEST(total_cents - amount_credited_cents, 0) ELSE amount_paid_cents END,
              amount_due_cents = CASE WHEN $4 IN ('paid', 'void', 'credited', 'refunded', 'written_off') THEN 0 ELSE amount_due_cents END,
              updated_by_user_id = $5,
              metadata = metadata || $6::jsonb,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
          AND id = $3
        RETURNING *`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        input.invoiceId,
        input.status,
        input.actor?.userId ?? null,
        JSON.stringify({ lastTransitionReason: input.reason ?? null })
      ]
    );
    const invoice = mapInvoice(result.rows[0]);
    await recordBillingAudit(target, {
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: input.actor?.userId,
      action: "billing_invoice_status_changed",
      entityType: "workspace_billing_invoices",
      entityId: invoice.id,
      data: {
        fromStatus: current.status,
        toStatus: invoice.status,
        reason: input.reason ?? null
      }
    });
    return invoice;
  });
}

export async function recordManualBillingAdjustment(input: {
  tenantKey?: string;
  workspaceKey?: string;
  actor?: BillingActor | null;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  adjustmentType: BillingAdjustmentType;
  amountCents: number;
  reason: string;
  metadata?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope(input);
  const amountCents = positiveCents(input.amountCents, "amountCents");
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("A manual billing adjustment reason is required.");
  }

  return withTransaction(async (target) => {
    const subscription = await selectSubscriptionForUpdate(
      target,
      scope.tenantKey,
      scope.workspaceKey,
      input.subscriptionId
    );

    let invoice: WorkspaceBillingInvoice | null = null;
    if (input.invoiceId) {
      const invoiceResult = await target.query<InvoiceRow>(
        `SELECT *
           FROM workspace_billing_invoices
          WHERE tenant_key = $1
            AND workspace_key = $2
            AND subscription_id = $3
            AND id = $4
          LIMIT 1
          FOR UPDATE`,
        [scope.tenantKey, scope.workspaceKey, subscription.id, input.invoiceId]
      );
      if (!invoiceResult.rows[0]) {
        throw new Error("Billing invoice was not found for this tenant workspace.");
      }
      invoice = mapInvoice(invoiceResult.rows[0]);
    }

    const adjustmentResult = await target.query<AdjustmentRow>(
      `INSERT INTO workspace_billing_adjustments (
         tenant_key,
         workspace_key,
         subscription_id,
         invoice_id,
         adjustment_type,
         amount_cents,
         currency,
         reason,
         created_by_user_id,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'ZAR', $7, $8, $9::jsonb)
       RETURNING *`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        subscription.id,
        input.invoiceId ?? null,
        input.adjustmentType,
        amountCents,
        reason,
        input.actor?.userId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    const adjustment = mapAdjustment(adjustmentResult.rows[0]);

    if (invoice && input.adjustmentType !== "plan_override") {
      const invoiceUpdate = await target.query<InvoiceRow>(
        `UPDATE workspace_billing_invoices
            SET amount_credited_cents = amount_credited_cents + CASE WHEN $4 = 'credit' THEN $5 ELSE 0 END,
                amount_refunded_cents = amount_refunded_cents + CASE WHEN $4 = 'refund' THEN $5 ELSE 0 END,
                amount_written_off_cents = amount_written_off_cents + CASE WHEN $4 = 'write_off' THEN $5 ELSE 0 END,
                amount_due_cents = CASE
                  WHEN $4 IN ('credit', 'write_off') THEN GREATEST(amount_due_cents - $5, 0)
                  ELSE amount_due_cents
                END,
                status = CASE
                  WHEN $4 = 'credit' THEN 'credited'
                  WHEN $4 = 'refund' THEN 'refunded'
                  WHEN $4 = 'write_off' THEN 'written_off'
                  ELSE status
                END,
                credited_at = CASE WHEN $4 = 'credit' THEN COALESCE(credited_at, now()) ELSE credited_at END,
                refunded_at = CASE WHEN $4 = 'refund' THEN COALESCE(refunded_at, now()) ELSE refunded_at END,
                written_off_at = CASE WHEN $4 = 'write_off' THEN COALESCE(written_off_at, now()) ELSE written_off_at END,
                updated_by_user_id = $6,
                updated_at = now()
          WHERE tenant_key = $1
            AND workspace_key = $2
            AND id = $3
          RETURNING *`,
        [
          scope.tenantKey,
          scope.workspaceKey,
          invoice.id,
          input.adjustmentType,
          amountCents,
          input.actor?.userId ?? null
        ]
      );
      invoice = mapInvoice(invoiceUpdate.rows[0]);
    }

    await recordBillingAudit(target, {
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: input.actor?.userId,
      action: "billing_adjustment_applied",
      entityType: "workspace_billing_adjustments",
      entityId: adjustment.id,
      data: {
        subscriptionId: subscription.id,
        invoiceId: input.invoiceId ?? null,
        adjustmentType: adjustment.adjustmentType,
        amountCents,
        reason
      }
    });

    return { adjustment, invoice };
  });
}

export async function updateBillingCollectionsState(input: {
  tenantKey?: string;
  workspaceKey?: string;
  actor?: BillingActor | null;
  subscriptionId?: string | null;
  invoiceId?: string | null;
  collectionStatus: BillingCollectionStatus;
  reason?: string | null;
  retryAt?: Date | string | null;
  gracePeriodEndsAt?: Date | string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope(input);

  return withTransaction(async (target) => {
    const subscription = await selectSubscriptionForUpdate(
      target,
      scope.tenantKey,
      scope.workspaceKey,
      input.subscriptionId
    );
    const nextSubscriptionStatus = subscriptionStatusFromCollection(input.collectionStatus);
    const eventType = dunningEventTypeForCollection(input.collectionStatus);
    const retryAt = input.retryAt ? asDate(input.retryAt, "retryAt") : null;
    const gracePeriodEndsAt = input.gracePeriodEndsAt
      ? asDate(input.gracePeriodEndsAt, "gracePeriodEndsAt")
      : null;

    const subscriptionResult = await target.query<SubscriptionRow>(
      `UPDATE workspace_billing_subscriptions
          SET status = $4,
              collection_status = $5,
              grace_period_ends_at = CASE WHEN $6::timestamptz IS NULL THEN grace_period_ends_at ELSE $6::timestamptz END,
              suspended_at = CASE WHEN $5 = 'suspended' THEN COALESCE(suspended_at, now()) ELSE suspended_at END,
              updated_by_user_id = $7,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
          AND id = $3
        RETURNING *`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        subscription.id,
        nextSubscriptionStatus,
        input.collectionStatus,
        gracePeriodEndsAt,
        input.actor?.userId ?? null
      ]
    );
    const updatedSubscription = mapSubscription(subscriptionResult.rows[0]);
    await syncWorkspaceModuleEntitlements(target, updatedSubscription);

    if (input.invoiceId && (input.collectionStatus === "overdue" || input.collectionStatus === "written_off")) {
      await target.query(
        `UPDATE workspace_billing_invoices
            SET status = CASE WHEN $4 = 'written_off' THEN 'written_off' ELSE 'overdue' END,
                written_off_at = CASE WHEN $4 = 'written_off' THEN COALESCE(written_off_at, now()) ELSE written_off_at END,
                amount_due_cents = CASE WHEN $4 = 'written_off' THEN 0 ELSE amount_due_cents END,
                updated_by_user_id = $5,
                updated_at = now()
          WHERE tenant_key = $1
            AND workspace_key = $2
            AND id = $3`,
        [
          scope.tenantKey,
          scope.workspaceKey,
          input.invoiceId,
          input.collectionStatus,
          input.actor?.userId ?? null
        ]
      );
    }

    const eventResult = await target.query<DunningEventRow>(
      `INSERT INTO workspace_billing_dunning_events (
         tenant_key,
         workspace_key,
         subscription_id,
         invoice_id,
         event_type,
         from_collection_status,
         to_collection_status,
         reason,
         retry_at,
         created_by_user_id,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING *`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        subscription.id,
        input.invoiceId ?? null,
        eventType,
        subscription.collectionStatus,
        input.collectionStatus,
        input.reason ?? null,
        retryAt,
        input.actor?.userId ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    const event = mapDunningEvent(eventResult.rows[0]);

    await recordBillingAudit(target, {
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: input.actor?.userId,
      action: "billing_collections_state_changed",
      entityType: "workspace_billing_dunning_events",
      entityId: event.id,
      data: {
        subscriptionId: subscription.id,
        invoiceId: input.invoiceId ?? null,
        fromCollectionStatus: subscription.collectionStatus,
        toCollectionStatus: input.collectionStatus,
        reason: input.reason ?? null
      }
    });

    return { subscription: updatedSubscription, event };
  });
}

export async function getCustomerSafeInvoiceExport(input: {
  tenantKey?: string;
  workspaceKey?: string;
  invoiceId: string;
}) {
  const scope = resolveTenantScope(input);
  const result = await db.query<InvoiceRow & { plan_key: string }>(
    `SELECT invoice.*, subscription.plan_key
       FROM workspace_billing_invoices invoice
       JOIN workspace_billing_subscriptions subscription
         ON subscription.id = invoice.subscription_id
        AND subscription.tenant_key = invoice.tenant_key
        AND subscription.workspace_key = invoice.workspace_key
      WHERE invoice.tenant_key = $1
        AND invoice.workspace_key = $2
        AND invoice.id = $3
      LIMIT 1`,
    [scope.tenantKey, scope.workspaceKey, input.invoiceId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Billing invoice was not found for this tenant workspace.");
  }
  const invoice = mapInvoice(row);
  return {
    formatVersion: "workspace-invoice-export.v1" as const,
    generatedAt: new Date().toISOString(),
    workspaceKey: invoice.workspaceKey,
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      planKey: row.plan_key,
      currency: invoice.currency,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      dueAt: invoice.dueAt,
      issuedAt: invoice.issuedAt,
      paidAt: invoice.paidAt,
      subtotalCents: invoice.subtotalCents,
      vatCents: invoice.vatCents,
      totalCents: invoice.totalCents,
      amountDueCents: invoice.amountDueCents,
      amountPaidCents: invoice.amountPaidCents,
      amountCreditedCents: invoice.amountCreditedCents,
      amountRefundedCents: invoice.amountRefundedCents,
      amountWrittenOffCents: invoice.amountWrittenOffCents,
      lines: invoice.lines
    }
  };
}
