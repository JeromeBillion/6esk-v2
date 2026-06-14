import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { recordAuditLog } from "@/server/audit";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";
import { runInBackground } from "@/server/async";
import { getTranscriptAiJobMetrics } from "@/server/calls/transcript-ai-jobs";
import { deliverPendingTranscriptAiJobs } from "@/server/calls/transcript-ai-worker";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), 25);
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const metrics = await getTranscriptAiJobMetrics(limit, tenantId);
  return Response.json(metrics);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveAdminMaintenanceScope(request, user, {
    sharedSecrets: [process.env.CALLS_OUTBOX_SECRET, process.env.INBOUND_SHARED_SECRET]
  });
  if (!scope.ok) {
    return scope.response;
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingTranscriptAiJobs({ limit, tenantId: scope.tenantId });
    await recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "call_transcript_ai_outbox_triggered",
      entityType: "call_transcript_ai_jobs",
      data: {
        authMode: scope.authMode,
        limit,
        ...result
      }
    });
    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run transcript AI outbox";
    runInBackground(recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "call_transcript_ai_outbox_trigger_failed",
      entityType: "call_transcript_ai_jobs",
      data: {
        authMode: scope.authMode,
        limit,
        detail
      }
    }), "Failed to record transcript AI outbox trigger failure audit event", {
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      limit
    });
    return Response.json(
      { error: "Failed to run transcript AI outbox", detail },
      { status: 500 }
    );
  }
}
