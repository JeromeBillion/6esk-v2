import { z } from "zod";
import {
  requireBackofficeSensitiveAccess,
  requireBackofficeStaff
} from "@/server/backoffice/authz";
import {
  changeTenantPlan,
  TenantLifecycleError,
  getTenantById,
  suspendTenant,
  reactivateTenant,
  closeTenant
} from "@/server/tenant/lifecycle";

const updateStatusSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suspend"),
    reason: z.string().optional()
  }),
  z.object({
    action: z.literal("reactivate"),
    reason: z.string().optional()
  }),
  z.object({
    action: z.literal("close"),
    reason: z.string().optional()
  }),
  z.object({
    action: z.literal("change_plan"),
    plan: z.string().min(1).max(80),
    reason: z.string().optional()
  })
]);

const paramsSchema = z.object({
  tenantId: z.string().uuid()
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const auth = await requireBackofficeStaff(request.headers);
  if (!auth.ok) return auth.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { tenantId } = parsedParams.data;
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  return Response.json({ tenant });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const auth = await requireBackofficeSensitiveAccess(request.headers);
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { tenantId } = parsedParams.data;
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  const { action, reason } = parsed.data;

  try {
    if (action === "suspend") {
      await suspendTenant(tenantId, reason || "Administrative suspension", auth.user.id);
    } else if (action === "reactivate") {
      await reactivateTenant(tenantId, auth.user.id);
    } else if (action === "close") {
      await closeTenant(tenantId, reason || "Administrative closure", auth.user.id);
    } else if (action === "change_plan") {
      await changeTenantPlan({
        tenantId,
        plan: parsed.data.plan,
        reason: reason || "Administrative plan change",
        actorUserId: auth.user.id
      });
    }

    const updated = await getTenantById(tenantId);
    return Response.json({ tenant: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    const status = error instanceof TenantLifecycleError ? error.status : 500;
    return Response.json({ error: message }, { status });
  }
}
