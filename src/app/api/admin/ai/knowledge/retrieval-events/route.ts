import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { listKnowledgeRetrievalEvents } from "@/server/ai/knowledge-base";
import { tenantScopeFromUser } from "@/server/tenant-context";

function parseLimit(request: Request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  if (Number.isNaN(raw)) return 25;
  return Math.min(Math.max(raw, 1), 100);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const events = await listKnowledgeRetrievalEvents(tenantScopeFromUser(user), {
    limit: parseLimit(request)
  });
  return Response.json({ events });
}
