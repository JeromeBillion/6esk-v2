import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { listKnowledgeQuarantineEvents } from "@/server/ai/knowledge-base";

function parseLimit(request: Request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  if (Number.isNaN(raw)) return 25;
  return Math.min(Math.max(raw, 1), 100);
}

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const events = await listKnowledgeQuarantineEvents(access.scope, {
    limit: parseLimit(request)
  });
  return Response.json({ events });
}
