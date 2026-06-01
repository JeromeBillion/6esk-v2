import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import {
  ingestKnowledgeDocument,
  KnowledgeUploadError,
  listKnowledgeDocuments
} from "@/server/ai/knowledge-base";
import { tenantScopeFromUser } from "@/server/tenant-context";

function readString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const documents = await listKnowledgeDocuments(tenantScopeFromUser(user));
  return Response.json({ documents });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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
    const scope = tenantScopeFromUser(user);
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
