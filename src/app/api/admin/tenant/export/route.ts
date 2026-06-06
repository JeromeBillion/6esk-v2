import { z } from "zod";
import { getSessionContext } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";
import { exportTenantDataBundle } from "@/server/tenant-export";
import {
  privilegedAccessErrorResponse,
  resolveTenantDataAccess
} from "@/server/auth/privileged-access-authorization";

const tenantExportSchema = z.object({
  limitPerSection: z.number().int().min(1).max(5_000).optional(),
  includeObjectPayloads: z.boolean().optional(),
  objectPayloadMaxBytes: z.number().int().min(1).max(25 * 1024 * 1024).optional()
});

export async function POST(request: Request) {
  const context = await getSessionContext();
  let access;
  try {
    access = await resolveTenantDataAccess(request, context?.user ?? null, {
      operation: "tenant_data_export",
      accessTypes: ["break_glass"],
      authProvider: context?.authProvider ?? null
    });
  } catch (error) {
    const response = privilegedAccessErrorResponse(error);
    if (response) return response;
    throw error;
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

  const scope = access.scope;
  const bundle = await exportTenantDataBundle(scope, parsed.data);
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: access.actorUserId,
    action: "tenant_data_export_created",
    entityType: "tenant_data_export",
    entityId: bundle.exportId,
    data: {
      sectionCount: bundle.sectionCount,
      totalRows: bundle.totalRows,
      exportedRows: bundle.exportedRows,
      objectStorageReferenceCount: bundle.objectStorageManifest.length,
      objectStoragePayloadSummary: bundle.objectStoragePayloadSummary,
      limitPerSection: bundle.limitPerSection,
      redactedSections: Object.keys(bundle.redaction.redactedColumnsBySection),
      accessMode: access.mode,
      privilegedAccessGrantId: access.grant?.id ?? null
    }
  });

  return Response.json({ status: "created", export: bundle });
}
