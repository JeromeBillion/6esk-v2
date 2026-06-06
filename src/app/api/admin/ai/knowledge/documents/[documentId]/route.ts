import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import {
  archiveKnowledgeDocument,
  KnowledgeBaseError,
  publishKnowledgeDocument
} from "@/server/ai/knowledge-base";

const statusSchema = z
  .object({
    status: z.enum(["published", "archived"])
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
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

  const parsed = statusSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { documentId } = await params;

  try {
    let result:
      | Awaited<ReturnType<typeof publishKnowledgeDocument>>
      | Awaited<ReturnType<typeof archiveKnowledgeDocument>>;
    let documentVersionId: string | null = null;

    if (parsed.data.status === "published") {
      const published = await publishKnowledgeDocument({
        tenantId: user.tenant_id,
        actorUserId: user.id,
        documentId
      });
      result = published;
      documentVersionId = published.version.id;
    } else {
      result = await archiveKnowledgeDocument({
        tenantId: user.tenant_id,
        actorUserId: user.id,
        documentId
      });
    }

    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action:
        parsed.data.status === "published"
          ? "knowledge_document_published"
          : "knowledge_document_archived",
      entityType: "knowledge_document",
      entityId: result.document.id,
      data: {
        status: parsed.data.status,
        documentVersionId
      }
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof KnowledgeBaseError && error.code === "DOCUMENT_NOT_FOUND") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof KnowledgeBaseError && error.code === "DOCUMENT_NOT_READY") {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof KnowledgeBaseError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "Failed to update knowledge document" }, { status: 500 });
  }
}
