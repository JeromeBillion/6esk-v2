import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { exportTenantDataBundle } from "@/server/tenant-export";
import { tenantScopeFromUser } from "@/server/tenant-context";

const tenantExportSchema = z.object({
  limitPerSection: z.number().int().min(1).max(5_000).optional()
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parsed = tenantExportSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const scope = tenantScopeFromUser(user);
  const bundle = await exportTenantDataBundle(scope, parsed.data);
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "tenant_data_export_created",
    entityType: "tenant_data_export",
    entityId: bundle.exportId,
    data: {
      sectionCount: bundle.sectionCount,
      totalRows: bundle.totalRows,
      exportedRows: bundle.exportedRows,
      objectStorageReferenceCount: bundle.objectStorageManifest.length,
      limitPerSection: bundle.limitPerSection,
      redactedSections: Object.keys(bundle.redaction.redactedColumnsBySection)
    }
  });

  return Response.json({ status: "created", export: bundle });
}
