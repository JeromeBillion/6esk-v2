import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import {
  createBillingAdjustment,
  createInvoiceDraft,
  getTenantBillingLifecycleSnapshot,
  recordCollectionEvent,
  syncTenantSubscriptionFromCatalog,
  transitionInvoiceStatus
} from "@/server/billing/lifecycle";
import { getTenantById } from "@/server/tenant/lifecycle";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("sync_subscription")
  }),
  z.object({
    action: z.literal("create_adjustment"),
    adjustmentType: z.enum(["credit", "refund", "write_off", "proration"]),
    amountCent: z.number().int(),
    reason: z.string().min(3).max(500),
    sourceInvoiceId: z.string().uuid().optional().nullable(),
    metadata: z.record(z.unknown()).optional()
  }),
  z.object({
    action: z.literal("create_invoice_draft"),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional()
  }),
  z.object({
    action: z.literal("transition_invoice"),
    invoiceId: z.string().uuid(),
    status: z.enum(["open", "paid", "void", "uncollectible"]),
    reason: z.string().max(500).optional()
  }),
  z.object({
    action: z.literal("record_collection_event"),
    invoiceId: z.string().uuid().optional().nullable(),
    eventType: z.enum([
      "invoice_opened",
      "payment_attempted",
      "payment_failed",
      "reminder_sent",
      "dunning_started",
      "dunning_escalated",
      "collections_paused",
      "invoice_paid",
      "invoice_voided",
      "write_off_recorded"
    ]),
    status: z.enum(["pending", "sent", "succeeded", "failed", "canceled"]).optional(),
    attemptNumber: z.number().int().min(1).max(50).optional(),
    metadata: z.record(z.unknown()).optional()
  })
]);

async function requireInternalTenant(tenantId: string) {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return {
      ok: false as const,
      response: Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 })
    };
  }
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return {
      ok: false as const,
      response: Response.json({ error: "Tenant not found" }, { status: 404 })
    };
  }
  return { ok: true as const, user, tenant };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await requireInternalTenant(tenantId);
  if (!auth.ok) return auth.response;

  const snapshot = await getTenantBillingLifecycleSnapshot({ tenantId });
  return Response.json({ tenant: auth.tenant, billing: snapshot });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await requireInternalTenant(tenantId);
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const actorUserId = auth.user?.id ?? null;
  try {
    if (parsed.data.action === "sync_subscription") {
      const result = await syncTenantSubscriptionFromCatalog({ tenantId, actorUserId });
      return Response.json({ status: "ok", result });
    }

    if (parsed.data.action === "create_adjustment") {
      const adjustment = await createBillingAdjustment({
        tenantId,
        adjustmentType: parsed.data.adjustmentType,
        amountCent: parsed.data.amountCent,
        reason: parsed.data.reason,
        sourceInvoiceId: parsed.data.sourceInvoiceId ?? null,
        actorUserId,
        metadata: parsed.data.metadata ?? null
      });
      return Response.json({ status: "ok", adjustment });
    }

    if (parsed.data.action === "create_invoice_draft") {
      const invoice = await createInvoiceDraft({
        tenantId,
        actorUserId,
        periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : undefined,
        periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : undefined
      });
      return Response.json({ status: "ok", invoice });
    }

    if (parsed.data.action === "transition_invoice") {
      const invoice = await transitionInvoiceStatus({
        tenantId,
        invoiceId: parsed.data.invoiceId,
        status: parsed.data.status,
        reason: parsed.data.reason ?? null,
        actorUserId
      });
      return Response.json({ status: "ok", invoice });
    }

    const event = await recordCollectionEvent({
      tenantId,
      invoiceId: parsed.data.invoiceId ?? null,
      eventType: parsed.data.eventType,
      status: parsed.data.status,
      attemptNumber: parsed.data.attemptNumber,
      actorUserId,
      metadata: parsed.data.metadata ?? null
    });
    return Response.json({ status: "ok", event });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
