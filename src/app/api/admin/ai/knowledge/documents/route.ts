import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import {
  ingestKnowledgeDocument,
  KnowledgeUploadError,
  listKnowledgeDocuments
} from "@/server/ai/knowledge-base";

function readString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const documents = await listKnowledgeDocuments(access.scope);
  return Response.json({ documents });
}

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart form body" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const document = await ingestKnowledgeDocument({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      filename: file.name,
      contentType: file.type,
      bytes,
      folderId: readString(form.get("folderId")),
      title: readString(form.get("title")),
      publish: readString(form.get("publish")) === "true",
      metadata: {
        uploadedByUserId: user?.id ?? null,
        route: "/api/admin/ai/knowledge/documents"
      }
    });
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "ai_knowledge_document_uploaded",
      entityType: "ai_knowledge_document",
      entityId: document.id,
      data: {
        filename: document.filename,
        title: document.title,
        folderId: document.folder_id,
        status: document.status,
        byteSize: document.byte_size,
        checksumSha256: document.checksum_sha256
      }
    });
    return Response.json({ status: "created", document });
  } catch (error) {
    if (error instanceof KnowledgeUploadError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
