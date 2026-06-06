import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { getAiSafetyDiagnostics } from "@/server/ai/safety-diagnostics";

function parseLimit(request: Request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  if (Number.isNaN(raw)) return 50;
  return Math.min(Math.max(raw, 1), 200);
}

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const diagnostics = await getAiSafetyDiagnostics(access.scope, {
    limit: parseLimit(request)
  });
  return Response.json(diagnostics);
}
