import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import {
  createKnowledgeFolder,
  KnowledgeUploadError,
  listKnowledgeFolders
} from "@/server/ai/knowledge-base";
import { tenantScopeFromUser } from "@/server/tenant-context";

const folderSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().uuid().optional().nullable()
});

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const folders = await listKnowledgeFolders(tenantScopeFromUser(user));
  return Response.json({ folders });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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
    const scope = tenantScopeFromUser(user);
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
