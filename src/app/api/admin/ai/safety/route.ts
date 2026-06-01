import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getAiSafetyDiagnostics } from "@/server/ai/safety-diagnostics";
import { tenantScopeFromUser } from "@/server/tenant-context";

function parseLimit(request: Request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  if (Number.isNaN(raw)) return 50;
  return Math.min(Math.max(raw, 1), 200);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const diagnostics = await getAiSafetyDiagnostics(tenantScopeFromUser(user), {
    limit: parseLimit(request)
  });
  return Response.json(diagnostics);
}
