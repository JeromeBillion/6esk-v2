import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { exportKnowledgeBundle } from "@/server/ai/knowledge-base";

const exportSchema = z.object({
  includeDeleted: z.boolean().optional(),
  includeBodyText: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional()
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

  const parsed = exportSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const bundle = await exportKnowledgeBundle(scope, parsed.data);
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "ai_knowledge_export_created",
    entityType: "ai_knowledge_export",
    entityId: bundle.exportId,
    data: {
      documentCount: bundle.documentCount,
      chunkCount: bundle.chunkCount,
      folderCount: bundle.folders.length,
      includeDeleted: bundle.includeDeleted,
      includeBodyText: bundle.includeBodyText,
      limit: parsed.data.limit ?? 200
    }
  });

  return Response.json({ status: "created", export: bundle });
}
