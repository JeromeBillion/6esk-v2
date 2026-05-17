import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import {
  KnowledgeBaseError,
  uploadKnowledgeDocument,
  type KnowledgeDocumentKind
} from "@/server/ai/knowledge-base";

const documentKindSchema = z
  .enum([
    "sop",
    "policy",
    "faq",
    "product_manual",
    "escalation_guide",
    "compliance_note",
    "playbook",
    "other"
  ])
  .default("sop");

function getOptionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "A file field is required" }, { status: 400 });
  }

  const folderId = getOptionalString(formData, "folderId");
  const title = getOptionalString(formData, "title");
  const documentKindResult = documentKindSchema.safeParse(
    getOptionalString(formData, "documentKind") ?? "sop"
  );
  if (!documentKindResult.success) {
    return Response.json({ error: "Invalid document kind" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadKnowledgeDocument({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      folderId,
      title,
      documentKind: documentKindResult.data as KnowledgeDocumentKind,
      fileName: file.name,
      contentType: file.type,
      buffer
    });

    await recordAuditLog({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      action: "knowledge_document_uploaded",
      entityType: "knowledge_document",
      entityId: result.document.id,
      data: {
        documentVersionId: result.version.id,
        folderId: result.document.folder_id ?? null,
        fileName: result.version.original_filename,
        contentType: result.version.content_type,
        sizeBytes: result.version.size_bytes,
        ingestionJobId: result.ingestionJob.id
      }
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof KnowledgeBaseError && error.code === "FOLDER_NOT_FOUND") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof KnowledgeBaseError && error.code === "INVALID_FILE") {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof KnowledgeBaseError) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ error: "Failed to upload knowledge document" }, { status: 500 });
  }
}
