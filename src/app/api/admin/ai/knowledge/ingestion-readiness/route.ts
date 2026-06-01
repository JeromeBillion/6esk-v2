import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getKnowledgeIngestionReadiness } from "@/server/ai/knowledge-base";

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json({ readiness: getKnowledgeIngestionReadiness() });
}
