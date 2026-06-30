import { z } from "zod";
import {
  requireBackofficeSensitiveAccess,
  requireBackofficeStaff
} from "@/server/backoffice/authz";
import {
  createBillingAdjustment,
  createInvoiceDraft,
  getTenantBillingLifecycleSnapshot,
  isBillingActionIdempotencyError,
  recordCollectionEvent,
  syncTenantSubscriptionFromCatalog,
  transitionInvoiceStatus
} from "@/server/billing/lifecycle";
import { getTenantById } from "@/server/tenant/lifecycle";

const idempotencyKey = z.string().trim().min(8).max(200);
const adjustmentAmountCent = z.number().int().min(-2_147_483_647).max(2_147_483_647).refine(
  (value) => value !== 0,
  { message: "Adjustment amount must be non-zero" }
);

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("sync_subscription"),
    idempotencyKey
  }),
  z.object({
    action: z.literal("create_adjustment"),
    idempotencyKey,
    adjustmentType: z.enum(["credit", "refund", "write_off", "proration"]),
    amountCent: adjustmentAmountCent,
    reason: z.string().min(3).max(500),
    sourceInvoiceId: z.string().uuid().optional().nullable(),
    metadata: z.record(z.unknown()).optional()
  }),
  z.object({
    action: z.literal("create_invoice_draft"),
    idempotencyKey,
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional()
  }),
  z.object({
    action: z.literal("transition_invoice"),
    idempotencyKey,
    invoiceId: z.string().uuid(),
    status: z.enum(["open", "paid", "void", "uncollectible"]),
    reason: z.string().max(500).optional()
  }),
  z.object({
    action: z.literal("record_collection_event"),
    idempotencyKey,
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

const paramsSchema = z.object({
  tenantId: z.string().uuid()
});

type BillingAction = z.infer<typeof actionSchema>;

function idempotencyPayload(action: BillingAction) {
  const { idempotencyKey: _idempotencyKey, ...payload } = action;
  return payload;
}

function responseKeyForAction(action: BillingAction["action"]) {
  if (action === "sync_subscription") return "result";
  if (action === "create_adjustment") return "adjustment";
  if (action === "record_collection_event") return "event";
  return "invoice";
}

async function requireInternalTenant(tenantId: string, requestHeaders: Headers, sensitive = false) {
  const auth = sensitive
    ? await requireBackofficeSensitiveAccess(requestHeaders)
    : await requireBackofficeStaff(requestHeaders);
  if (!auth.ok) return auth;

  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return {
      ok: false as const,
      response: Response.json({ error: "Tenant not found" }, { status: 404 })
    };
  }
  return { ok: true as const, user: auth.user, tenant };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { tenantId } = parsedParams.data;
  const auth = await requireInternalTenant(tenantId, request.headers);
  if (!auth.ok) return auth.response;

  const snapshot = await getTenantBillingLifecycleSnapshot({ tenantId });
  return Response.json({ tenant: auth.tenant, billing: snapshot });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { tenantId } = parsedParams.data;
  const auth = await requireInternalTenant(tenantId, request.headers, true);
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
  if (parsed.data.action === "create_invoice_draft" && parsed.data.periodStart && parsed.data.periodEnd) {
    const periodStart = new Date(parsed.data.periodStart);
    const periodEnd = new Date(parsed.data.periodEnd);
    if (periodEnd <= periodStart) {
      return Response.json({ error: "Invoice period end must be after period start" }, { status: 400 });
    }
  }

  const actorUserId = auth.user.id;
  const payloadForIdempotency = idempotencyPayload(parsed.data);
  const responseKey = responseKeyForAction(parsed.data.action);
  try {
    if (parsed.data.action === "sync_subscription") {
      const result = await syncTenantSubscriptionFromCatalog({
        tenantId,
        actorUserId,
        idempotencyKey: parsed.data.idempotencyKey,
        idempotencyPayload: payloadForIdempotency
      });
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
        metadata: parsed.data.metadata ?? null,
        idempotencyKey: parsed.data.idempotencyKey,
        idempotencyPayload: payloadForIdempotency
      });
      return Response.json({ status: "ok", adjustment });
    }

    if (parsed.data.action === "create_invoice_draft") {
      const invoice = await createInvoiceDraft({
        tenantId,
        actorUserId,
        periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : undefined,
        periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : undefined,
        idempotencyKey: parsed.data.idempotencyKey,
        idempotencyPayload: payloadForIdempotency
      });
      return Response.json({ status: "ok", invoice });
    }

    if (parsed.data.action === "transition_invoice") {
      const invoice = await transitionInvoiceStatus({
        tenantId,
        invoiceId: parsed.data.invoiceId,
        status: parsed.data.status,
        reason: parsed.data.reason ?? null,
        actorUserId,
        idempotencyKey: parsed.data.idempotencyKey,
        idempotencyPayload: payloadForIdempotency
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
      metadata: parsed.data.metadata ?? null,
      idempotencyKey: parsed.data.idempotencyKey,
      idempotencyPayload: payloadForIdempotency
    });
    return Response.json({ status: "ok", event });
  } catch (error) {
    if (isBillingActionIdempotencyError(error)) {
      if (error.code === "idempotency_replay") {
        return Response.json({
          status: "ok",
          deduplicated: true,
          [responseKey]: error.response
        });
      }
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
