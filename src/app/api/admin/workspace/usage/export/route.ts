import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import {
  buildWorkspaceUsageExport,
  workspaceUsageExportToCsv
} from "@/server/billing/catalog";
import { getWorkspaceModuleUsageSummary } from "@/server/module-metering";
import { getWorkspaceModules } from "@/server/workspace-modules";

function clampWindowDays(value: string | null) {
  const parsed = Number(value ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(90, Math.max(1, Math.trunc(parsed)));
}

function exportFilename(workspaceKey: string, extension: "csv" | "json") {
  const safeWorkspace = workspaceKey.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "workspace";
  return `6esk-usage-${safeWorkspace}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const days = clampWindowDays(url.searchParams.get("days"));
  const format = url.searchParams.get("format")?.trim().toLowerCase() === "csv" ? "csv" : "json";
  const { user, scope } = access;

  const [modules, usage] = await Promise.all([
    getWorkspaceModules(scope.workspaceKey, scope.tenantKey),
    getWorkspaceModuleUsageSummary({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      windowDays: days
    })
  ]);
  const exportPayload = buildWorkspaceUsageExport({
    workspaceKey: scope.workspaceKey,
    modules: modules.modules,
    usage
  });

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "workspace_usage_exported",
    entityType: "workspace_usage",
    entityId: scope.workspaceKey,
    data: {
      format,
      windowDays: days,
      moduleCount: exportPayload.usage.modules.length,
      dailyBucketCount: exportPayload.usage.daily.length
    }
  });

  if (format === "csv") {
    return new Response(workspaceUsageExportToCsv(exportPayload), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFilename(scope.workspaceKey, "csv")}"`
      }
    });
  }

  return Response.json(exportPayload, {
    headers: {
      "content-disposition": `attachment; filename="${exportFilename(scope.workspaceKey, "json")}"`
    }
  });
}
