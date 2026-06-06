import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { publishKnowledgeDocument } from "@/server/ai/knowledge-base";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  const { documentId } = await params;
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
