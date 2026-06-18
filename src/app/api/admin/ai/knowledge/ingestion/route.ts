import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { recordAuditLog } from "@/server/audit";
import { runInBackground } from "@/server/async";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";
import { deliverPendingKnowledgeIngestionJobs } from "@/server/ai/knowledge-ingestion-worker";
import {
  getKnowledgeIngestionMetrics,
  getKnowledgeIngestionReadiness
} from "@/server/ai/knowledge-base";

function readLimit(request: Request) {
  const url = new URL(request.url);
  return Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1), 50);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [metrics, readiness] = await Promise.all([
    getKnowledgeIngestionMetrics(tenantId),
    Promise.resolve(getKnowledgeIngestionReadiness())
  ]);
  return Response.json({
    tenantId,
    queue: metrics,
    readiness
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveAdminMaintenanceScope(request, user, {
    sharedSecrets: [
      process.env.KNOWLEDGE_INGESTION_SECRET,
      process.env.CRON_SECRET,
      process.env.JOBS_RUNNER_SECRET
    ]
  });
  if (!scope.ok) {
    return scope.response;
  }

  const limit = readLimit(request);

  try {
    const result = await deliverPendingKnowledgeIngestionJobs({
      limit,
      tenantId: scope.tenantId
    });

    await recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "knowledge_ingestion_triggered",
      entityType: "knowledge_ingestion_jobs",
      data: {
        authMode: scope.authMode,
        limit,
        ...result
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run knowledge ingestion";
    runInBackground(recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "knowledge_ingestion_trigger_failed",
      entityType: "knowledge_ingestion_jobs",
      data: {
        authMode: scope.authMode,
        limit,
        detail
      }
    }), "Failed to record knowledge ingestion trigger failure audit event", {
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      limit,
      authMode: scope.authMode
    });
    return Response.json(
      { error: "Failed to run knowledge ingestion", detail },
      { status: 500 }
    );
  }
}
