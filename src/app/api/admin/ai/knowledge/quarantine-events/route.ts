import { listKnowledgeQuarantineEvents } from "@/server/ai/knowledge-base";
import { requireKnowledgeBaseAdminAccess } from "../access";

function readLimit(request: Request) {
  const url = new URL(request.url);
  return Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25) || 25, 1), 100);
}

export async function GET(request: Request) {
  const access = await requireKnowledgeBaseAdminAccess();
  if (!access.ok) return access.response;

  const events = await listKnowledgeQuarantineEvents(access.access.tenantId, {
    limit: readLimit(request)
  });

  return Response.json({
    tenantId: access.access.tenantId,
    events
  });
}
