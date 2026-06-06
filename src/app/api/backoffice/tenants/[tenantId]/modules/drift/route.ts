import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { getTenantById } from "@/server/tenant/lifecycle";
import {
  getTenantEntitlementDrift,
  repairTenantEntitlementDrift
} from "@/server/tenant/entitlement-drift";
import { recordAuditLog } from "@/server/audit";

export async function GET(
  _request: Request,
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
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }

  const { tenantId } = await params;
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  const result = await repairTenantEntitlementDrift(tenantId);
  await recordAuditLog({
    tenantId,
    actorUserId: user?.id ?? null,
    action: "tenant_entitlement_drift_repaired",
    entityType: "tenant",
    entityId: tenantId,
    data: {
      workspaceKey: result.report.workspaceKey,
      repaired: result.repaired,
      drift: result.report.drift
    }
  });

  return Response.json({
    status: "ok",
    repaired: result.repaired,
    driftCount: result.report.drift.length,
    report: result.report
  });
}
