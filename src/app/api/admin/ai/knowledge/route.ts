import { listKnowledgeBase } from "@/server/ai/knowledge-base";
import { requireKnowledgeBaseAdminAccess } from "./access";

export async function GET() {
  const access = await requireKnowledgeBaseAdminAccess();
  if (!access.ok) return access.response;

  const { tenantId } = access.access;
  const knowledgeBase = await listKnowledgeBase(tenantId);
  return Response.json({
    tenantId,
    ...knowledgeBase
  });
}
