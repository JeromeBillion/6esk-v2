import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import {
  createKnowledgeFolder,
  KnowledgeBaseError
} from "@/server/ai/knowledge-base";

const createFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    parentFolderId: z.string().uuid().nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    visibility: z.enum(["ai_visible", "admin_only"]).optional()
  })
  .strict();

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createFolderSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const folder = await createKnowledgeFolder({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      name: parsed.data.name,
      parentFolderId: parsed.data.parentFolderId ?? null,
      description: parsed.data.description ?? null,
      visibility: parsed.data.visibility ?? "ai_visible"
    });

    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "knowledge_folder_created",
      entityType: "knowledge_folder",
      entityId: folder.id,
      data: {
        name: folder.name,
        parentFolderId: folder.parent_folder_id ?? null,
        visibility: folder.visibility
      }
    });

    return Response.json({ folder }, { status: 201 });
  } catch (error) {
    if (error instanceof KnowledgeBaseError && error.code === "FOLDER_NOT_FOUND") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof KnowledgeBaseError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "Failed to create knowledge folder" }, { status: 500 });
  }
}
