import { z } from "zod";
import {
  requireBackofficeSensitiveAccess,
  requireBackofficeStaff
} from "@/server/backoffice/authz";
import { getTenantById } from "@/server/tenant/lifecycle";
import {
  getTenantEntitlementDrift,
  repairTenantEntitlementDrift
} from "@/server/tenant/entitlement-drift";

const paramsSchema = z.object({
  tenantId: z.string().uuid()
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const auth = await requireBackofficeStaff();
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

  const report = await getTenantEntitlementDrift(tenantId);
  return Response.json({
    driftCount: report.drift.length,
    ...report
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const auth = await requireBackofficeSensitiveAccess();
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

  const result = await repairTenantEntitlementDrift(tenantId, undefined, {
    actorUserId: auth.user.id
  });

  return Response.json({
    status: "ok",
    repaired: result.repaired,
    driftCount: result.report.drift.length,
    report: result.report
  });
}
