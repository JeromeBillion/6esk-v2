import { getSessionUser } from "@/server/auth/session";
import { isTenantAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { getTenantBillingLifecycleSnapshot } from "@/server/billing/lifecycle";
import {
  buildWorkspaceUsageExport,
  workspaceUsageExportToCsv
} from "@/server/billing/usage-export";
import { getWorkspaceModuleUsageSummary } from "@/server/module-metering";
import { DEFAULT_WORKSPACE_KEY, getWorkspaceModules } from "@/server/workspace-modules";

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
  const format = url.searchParams.get("format")?.trim().toLowerCase() === "csv" ? "csv" : "json";
  const workspaceKey = DEFAULT_WORKSPACE_KEY;

  const [modules, usage, billingLifecycle] = await Promise.all([
    getWorkspaceModules(workspaceKey, tenantId),
    getWorkspaceModuleUsageSummary({ tenantId, workspaceKey, windowDays: days }),
    getTenantBillingLifecycleSnapshot({ tenantId, workspaceKey })
  ]);
  const exportPayload = buildWorkspaceUsageExport({
    workspaceKey,
    modules: modules.modules,
    usage,
    billingLifecycle
  });

  await recordAuditLog({
    tenantId,
    actorUserId: user.id,
    action: "workspace_usage_exported",
    entityType: "workspace_usage",
    entityId: workspaceKey,
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
        "content-disposition": `attachment; filename="${exportFilename(workspaceKey, "csv")}"`
      }
    });
  }

  return Response.json(exportPayload, {
    headers: {
      "content-disposition": `attachment; filename="${exportFilename(workspaceKey, "json")}"`
    }
  });
}
