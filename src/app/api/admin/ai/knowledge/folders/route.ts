import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import {
  createKnowledgeFolder,
  KnowledgeUploadError,
  listKnowledgeFolders
} from "@/server/ai/knowledge-base";

const folderSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().uuid().optional().nullable()
});

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const folders = await listKnowledgeFolders(access.scope);
  return Response.json({ folders });
}

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = folderSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const folder = await createKnowledgeFolder({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      ...parsed.data
    });
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "ai_knowledge_folder_created",
      entityType: "ai_knowledge_folder",
      entityId: folder.id,
      data: {
        name: folder.name,
        parentId: folder.parent_id
      }
    });
    return Response.json({ status: "created", folder });
  } catch (error) {
    if (error instanceof KnowledgeUploadError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
