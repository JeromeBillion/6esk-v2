import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { runInBackground } from "@/server/async";
import { deliverPendingKnowledgeIngestionJobs } from "@/server/ai/knowledge-ingestion-worker";
import { getKnowledgeIngestionMetrics } from "@/server/ai/knowledge-base";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

function readLimit(request: Request) {
  const url = new URL(request.url);
  return Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1), 50);
}

function readWorkerSecret() {
  return process.env.KNOWLEDGE_INGESTION_SECRET ?? process.env.CRON_SECRET ?? "";
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const metrics = await getKnowledgeIngestionMetrics(user.tenant_id);
  return Response.json({
    tenantId: user.tenant_id,
    queue: metrics
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const secret = readWorkerSecret();
  const provided = request.headers.get("x-6esk-secret");
  const isAdminTrigger = Boolean(user && isLeadAdmin(user));
  const isWorkerTrigger = Boolean(secret && provided === secret);

  if (!isAdminTrigger && !isWorkerTrigger) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = readLimit(request);
  const tenantId = isAdminTrigger ? user!.tenant_id : null;

  try {
    const result = await deliverPendingKnowledgeIngestionJobs({
      limit,
      tenantId
    });

    await recordAuditLog({
      tenantId: tenantId ?? DEFAULT_TENANT_ID,
      actorUserId: user?.id ?? null,
      action: "knowledge_ingestion_triggered",
      entityType: "knowledge_ingestion_jobs",
      data: {
        limit,
        tenantScoped: Boolean(tenantId),
        ...result
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run knowledge ingestion";
    runInBackground(recordAuditLog({
      tenantId: tenantId ?? DEFAULT_TENANT_ID,
      actorUserId: user?.id ?? null,
      action: "knowledge_ingestion_trigger_failed",
      entityType: "knowledge_ingestion_jobs",
      data: {
        limit,
        tenantScoped: Boolean(tenantId),
        detail
      }
    }), "Failed to record knowledge ingestion trigger failure audit event", {
      tenantId: tenantId ?? DEFAULT_TENANT_ID,
      actorUserId: user?.id ?? null,
      limit,
      tenantScoped: Boolean(tenantId)
    });
    return Response.json(
      { error: "Failed to run knowledge ingestion", detail },
      { status: 500 }
    );
  }
}
