import { getSessionUser } from "@/server/auth/session";
import { isTenantAdmin } from "@/server/auth/roles";
import { getWorkspaceModuleUsageSummary } from "@/server/module-metering";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

function clampWindowDays(value: string | null) {
  const parsed = Number(value ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(90, Math.max(1, Math.trunc(parsed)));
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isTenantAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = user.tenant_id?.trim();
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const days = clampWindowDays(url.searchParams.get("days"));
  const summary = await getWorkspaceModuleUsageSummary({
    tenantId,
    workspaceKey: DEFAULT_WORKSPACE_KEY,
    windowDays: days
  });

  return Response.json({ summary });
}
