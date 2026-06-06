import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { runTenantIsolationAudit } from "@/server/tenant-isolation-audit";

const auditSchema = z.object({
  mode: z.enum(["standard", "external_launch"]).optional(),
  sampleLimit: z.number().int().min(1).max(25).optional(),
  includePassed: z.boolean().optional()
});

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parsed = auditSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const report = await runTenantIsolationAudit(parsed.data);
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "tenant_isolation_audit_generated",
    entityType: "tenant_isolation_audit",
    entityId: report.reportId,
    data: {
      mode: report.mode,
      ready: report.ready,
      blockerCount: report.blockerCount,
      warningCount: report.warningCount,
      infoCount: report.infoCount,
      evaluatedCheckCount: report.evaluatedCheckCount,
      failedCheckCount: report.failedCheckCount,
      passedCheckCount: report.passedCheckCount,
      sampleLimit: report.sampleLimit,
      summary: report.summary
    }
  });

  return Response.json({ status: "created", report });
}
