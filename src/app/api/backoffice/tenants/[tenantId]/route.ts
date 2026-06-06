import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }

  const { tenantId } = await params;
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
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }

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

  const { tenantId } = await params;
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  const { action, reason } = parsed.data;

  try {
    if (action === "suspend") {
      await suspendTenant(tenantId, reason || "Administrative suspension", user?.id);
    } else if (action === "reactivate") {
      await reactivateTenant(tenantId, user?.id);
    } else if (action === "close") {
      await closeTenant(tenantId, reason || "Administrative closure", user?.id);
    } else if (action === "change_plan") {
      await changeTenantPlan({
        tenantId,
        plan: parsed.data.plan,
        reason: reason || "Administrative plan change",
        actorUserId: user?.id
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
