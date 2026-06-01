import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { publishKnowledgeDocument } from "@/server/ai/knowledge-base";
import { tenantScopeFromUser } from "@/server/tenant-context";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { documentId } = await params;
  const scope = tenantScopeFromUser(user);
  const document = await publishKnowledgeDocument({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    documentId
  });
  if (!document) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "ai_knowledge_document_published",
    entityType: "ai_knowledge_document",
    entityId: document.id,
    data: {
      filename: document.filename,
      title: document.title,
      folderId: document.folder_id,
      publishedAt: document.published_at,
      checksumSha256: document.checksum_sha256
    }
  });

  return Response.json({ status: "published", document });
}
