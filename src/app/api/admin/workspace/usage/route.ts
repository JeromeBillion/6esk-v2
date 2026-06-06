import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { getWorkspaceModuleUsageSummary } from "@/server/module-metering";

function clampWindowDays(value: string | null) {
  const parsed = Number(value ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(90, Math.max(1, Math.trunc(parsed)));
}

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const days = clampWindowDays(url.searchParams.get("days"));
  const { scope } = access;
  const summary = await getWorkspaceModuleUsageSummary({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    windowDays: days
  });

  return Response.json({ summary });
}
