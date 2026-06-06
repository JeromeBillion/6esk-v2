import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { setKnowledgeDocumentLegalHold } from "@/server/ai/knowledge-base";

const legalHoldSchema = z.object({
  legalHold: z.boolean(),
  reason: z.string().max(500).optional().nullable()
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = legalHoldSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { documentId } = await params;
  const document = await setKnowledgeDocumentLegalHold({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    documentId,
    legalHold: parsed.data.legalHold,
    reason: parsed.data.reason ?? null,
    actorUserId: user?.id ?? null
  });
  if (!document) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: parsed.data.legalHold
      ? "ai_knowledge_document_legal_hold_enabled"
      : "ai_knowledge_document_legal_hold_released",
    entityType: "ai_knowledge_document",
    entityId: document.id,
    data: {
      filename: document.filename,
      title: document.title,
      legalHold: parsed.data.legalHold,
      reason: parsed.data.reason ?? null
    }
  });

  return Response.json({
    status: parsed.data.legalHold ? "legal_hold_enabled" : "legal_hold_released",
    document
  });
}
