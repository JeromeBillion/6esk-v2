import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { listKnowledgeQuarantineEvents } from "@/server/ai/knowledge-base";

function readLimit(request: Request) {
  const url = new URL(request.url);
  return Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25) || 25, 1), 100);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const events = await listKnowledgeQuarantineEvents(user.tenant_id, {
    limit: readLimit(request)
  });

  return Response.json({
    tenantId: user.tenant_id,
    events
  });
}
