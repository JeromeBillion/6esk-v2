import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { getKnowledgeIngestionReadiness } from "@/server/ai/knowledge-base";

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  return Response.json({ readiness: getKnowledgeIngestionReadiness() });
}
