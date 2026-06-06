import { z } from "zod";
import { recordAuditLog } from "@/server/audit";
import { getSessionContext } from "@/server/auth/session";
import {
  privilegedAccessErrorResponse,
  resolveTenantDataAccess
} from "@/server/auth/privileged-access-authorization";
import {
  executeTenantOffboardingAnonymization,
  previewTenantOffboarding,
  tenantOffboardingErrorResponse
} from "@/server/tenant-offboarding";

const tenantOffboardingSchema = z.object({
  mode: z.enum(["anonymize", "delete"]).optional().default("anonymize"),
  dryRun: z.boolean().optional().default(true),
  confirmation: z.string().optional(),
  reason: z.string().optional()
});

export async function POST(request: Request) {
  const context = await getSessionContext();
  let access;
  try {
    access = await resolveTenantDataAccess(request, context?.user ?? null, {
      operation: "tenant_offboarding",
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

  const parsed = tenantOffboardingSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const scope = access.scope;
  if (parsed.data.dryRun || parsed.data.mode === "delete") {
    const report = await previewTenantOffboarding(scope, { mode: parsed.data.mode });
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: access.actorUserId,
      action: "tenant_offboarding_preview_created",
      entityType: "tenant_offboarding",
      entityId: report.operationId,
      data: {
        mode: report.mode,
        totalRows: report.totalRows,
        tableCount: report.tableCount,
        blockerCount: report.blockers.length,
        legalHoldKnowledgeDocumentCount: report.legalHold.knowledgeDocumentCount,
        accessMode: access.mode,
        privilegedAccessGrantId: access.grant?.id ?? null
      }
    });

    return Response.json(
      { status: report.blockers.length > 0 ? "blocked" : "preview", offboarding: report },
      { status: parsed.data.mode === "delete" && parsed.data.dryRun === false ? 409 : 200 }
    );
  }

  try {
    const report = await executeTenantOffboardingAnonymization({
      scope,
      confirmation: parsed.data.confirmation,
      reason: parsed.data.reason,
      actorUserId: access.actorUserId,
      accessMode: access.mode,
      privilegedAccessGrantId: access.grant?.id ?? null
    });
    return Response.json({ status: "executed", offboarding: report });
  } catch (error) {
    const response = tenantOffboardingErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
