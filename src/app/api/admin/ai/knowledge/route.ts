import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { listKnowledgeBase } from "@/server/ai/knowledge-base";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = user.tenant_id;
  const knowledgeBase = await listKnowledgeBase(tenantId);
  return Response.json({
    tenantId,
    ...knowledgeBase
  });
}
