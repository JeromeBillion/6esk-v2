import { z } from "zod";
import { requireBillingAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import {
  createWorkspaceBillingInvoice,
  ensureWorkspaceBillingSubscription,
  getCustomerSafeInvoiceExport,
  getWorkspaceBillingOverview,
  recordBillingPlanChange,
  recordManualBillingAdjustment,
  transitionWorkspaceBillingInvoice,
  updateBillingCollectionsState,
  updateBillingSubscriptionLifecycle
} from "@/server/billing/lifecycle";

const moduleFlagsSchema = z
  .object({
    email: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
    voice: z.boolean().optional(),
    aiAutomation: z.boolean().optional(),
    vanillaWebchat: z.boolean().optional()
  })
  .optional();

const metadataSchema = z.record(z.unknown()).optional();
const dateSchema = z.string().min(1).optional();
const nullableDateSchema = z.string().min(1).nullable().optional();
const uuidSchema = z.string().uuid();

const billingSubscriptionStatusSchema = z.enum([
  "trialing",
  "active",
  "past_due",
  "grace_period",
  "downgrade_pending",
  "suspended",
  "canceled",
  "written_off"
]);

const billingCollectionStatusSchema = z.enum([
  "current",
  "retrying",
  "grace_period",
  "overdue",
  "suspended",
  "restored",
  "written_off"
]);

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ensure_subscription"),
    planKey: z.string().min(1).optional(),
    modules: moduleFlagsSchema,
    status: billingSubscriptionStatusSchema.optional(),
    collectionStatus: billingCollectionStatusSchema.optional(),
    currentPeriodStart: dateSchema,
    currentPeriodEnd: dateSchema,
    metadata: metadataSchema
  }),
  z.object({
    action: z.literal("subscription_lifecycle"),
    subscriptionId: uuidSchema.optional(),
    status: billingSubscriptionStatusSchema,
    collectionStatus: billingCollectionStatusSchema.optional(),
    modules: moduleFlagsSchema,
    cancelAt: nullableDateSchema,
    downgradeAt: nullableDateSchema,
    suspendedAt: nullableDateSchema,
    gracePeriodEndsAt: nullableDateSchema,
    reason: z.string().min(1),
    metadata: metadataSchema
  }),
  z.object({
    action: z.literal("plan_change"),
    subscriptionId: uuidSchema.optional(),
    toPlanKey: z.string().min(1).optional(),
    toModules: moduleFlagsSchema.unwrap(),
    effectiveAt: dateSchema,
    changeType: z.enum(["upgrade", "downgrade", "module_change", "cancel", "reactivate"]).optional(),
    metadata: metadataSchema
  }),
  z.object({
    action: z.literal("manual_adjustment"),
    subscriptionId: uuidSchema.optional(),
    invoiceId: uuidSchema.nullable().optional(),
    adjustmentType: z.enum(["credit", "refund", "write_off", "plan_override"]),
    amountCents: z.number().int().positive(),
    reason: z.string().min(1),
    metadata: metadataSchema
  }),
  z.object({
    action: z.literal("create_invoice"),
    subscriptionId: uuidSchema.optional(),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    dueAt: nullableDateSchema,
    status: z.enum(["draft", "issued"]).optional(),
    metadata: metadataSchema
  }),
  z.object({
    action: z.literal("invoice_status"),
    invoiceId: uuidSchema,
    status: z.enum(["draft", "issued", "paid", "void", "credited", "refunded", "overdue", "written_off"]),
    reason: z.string().optional()
  }),
  z.object({
    action: z.literal("collections_state"),
    subscriptionId: uuidSchema.optional(),
    invoiceId: uuidSchema.nullable().optional(),
    collectionStatus: billingCollectionStatusSchema,
    reason: z.string().optional(),
    retryAt: nullableDateSchema,
    gracePeriodEndsAt: nullableDateSchema,
    metadata: metadataSchema
  })
]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Billing request failed";
}

export async function GET(request: Request) {
  const auth = await requireBillingAdminAccess({ requireMfa: true });
  if (!auth.ok) return auth.response;
  const { user, scope } = auth;
  const url = new URL(request.url);
  const invoiceId = url.searchParams.get("invoiceId")?.trim();

  if (invoiceId) {
    const exportPayload = await getCustomerSafeInvoiceExport({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      invoiceId
    });
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user.id,
      action: "billing_invoice_exported",
      entityType: "workspace_billing_invoices",
      entityId: invoiceId,
      data: {
        formatVersion: exportPayload.formatVersion,
        invoiceStatus: exportPayload.invoice.status,
        lineCount: exportPayload.invoice.lines.length
      }
    });
    return Response.json(exportPayload);
  }

  const overview = await getWorkspaceBillingOverview(scope);
  return Response.json({ overview });
}

export async function POST(request: Request) {
  const auth = await requireBillingAdminAccess({ requireMfa: true });
  if (!auth.ok) return auth.response;
  const { user, scope } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const actor = { userId: user.id };
    const base = {
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actor
    };

    switch (parsed.data.action) {
      case "ensure_subscription": {
        const subscription = await ensureWorkspaceBillingSubscription({
          ...base,
          planKey: parsed.data.planKey,
          modules: parsed.data.modules,
          status: parsed.data.status,
          collectionStatus: parsed.data.collectionStatus,
          currentPeriodStart: parsed.data.currentPeriodStart,
          currentPeriodEnd: parsed.data.currentPeriodEnd,
          metadata: parsed.data.metadata
        });
        return Response.json({ status: "updated", subscription });
      }
      case "subscription_lifecycle": {
        const subscription = await updateBillingSubscriptionLifecycle({
          ...base,
          subscriptionId: parsed.data.subscriptionId,
          status: parsed.data.status,
          collectionStatus: parsed.data.collectionStatus,
          modules: parsed.data.modules,
          cancelAt: parsed.data.cancelAt,
          downgradeAt: parsed.data.downgradeAt,
          suspendedAt: parsed.data.suspendedAt,
          gracePeriodEndsAt: parsed.data.gracePeriodEndsAt,
          reason: parsed.data.reason,
          metadata: parsed.data.metadata
        });
        return Response.json({ status: "updated", subscription });
      }
      case "plan_change": {
        const result = await recordBillingPlanChange({
          ...base,
          subscriptionId: parsed.data.subscriptionId,
          toPlanKey: parsed.data.toPlanKey,
          toModules: parsed.data.toModules,
          effectiveAt: parsed.data.effectiveAt,
          changeType: parsed.data.changeType,
          metadata: parsed.data.metadata
        });
        return Response.json({ status: "recorded", ...result });
      }
      case "manual_adjustment": {
        const result = await recordManualBillingAdjustment({
          ...base,
          subscriptionId: parsed.data.subscriptionId,
          invoiceId: parsed.data.invoiceId,
          adjustmentType: parsed.data.adjustmentType,
          amountCents: parsed.data.amountCents,
          reason: parsed.data.reason,
          metadata: parsed.data.metadata
        });
        return Response.json({ status: "applied", ...result });
      }
      case "create_invoice": {
        const invoice = await createWorkspaceBillingInvoice({
          ...base,
          subscriptionId: parsed.data.subscriptionId,
          periodStart: parsed.data.periodStart,
          periodEnd: parsed.data.periodEnd,
          dueAt: parsed.data.dueAt,
          status: parsed.data.status,
          metadata: parsed.data.metadata
        });
        return Response.json({ status: "created", invoice });
      }
      case "invoice_status": {
        const invoice = await transitionWorkspaceBillingInvoice({
          ...base,
          invoiceId: parsed.data.invoiceId,
          status: parsed.data.status,
          reason: parsed.data.reason
        });
        return Response.json({ status: "updated", invoice });
      }
      case "collections_state": {
        const result = await updateBillingCollectionsState({
          ...base,
          subscriptionId: parsed.data.subscriptionId,
          invoiceId: parsed.data.invoiceId,
          collectionStatus: parsed.data.collectionStatus,
          reason: parsed.data.reason,
          retryAt: parsed.data.retryAt,
          gracePeriodEndsAt: parsed.data.gracePeriodEndsAt,
          metadata: parsed.data.metadata
        });
        return Response.json({ status: "updated", ...result });
      }
    }
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
}
