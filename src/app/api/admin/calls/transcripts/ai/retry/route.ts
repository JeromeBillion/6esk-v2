import { getSessionUser } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";
import { runInBackground } from "@/server/async";
import { retryFailedTranscriptAiJobs } from "@/server/calls/transcript-ai-jobs";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveAdminMaintenanceScope(request, user, {
    sharedSecrets: [process.env.CALLS_OUTBOX_SECRET, process.env.INBOUND_SHARED_SECRET]
  });
  if (!scope.ok) {
    return scope.response;
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25) || 25, 1), 100);
  const body = (await request.json().catch(() => ({}))) as { jobIds?: string[] };

  try {
    const result = await retryFailedTranscriptAiJobs({
      limit,
      jobIds: Array.isArray(body.jobIds) ? body.jobIds : undefined,
      tenantId: scope.tenantId
    });
    await recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "call_transcript_ai_retry_triggered",
      entityType: "call_transcript_ai_jobs",
      data: {
        authMode: scope.authMode,
        limit,
        ...result
      }
    });
    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to retry transcript AI jobs";
    runInBackground(recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "call_transcript_ai_retry_failed",
      entityType: "call_transcript_ai_jobs",
      data: {
        authMode: scope.authMode,
        limit,
        detail
      }
    }), "Failed to record transcript AI retry failure audit event", {
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      limit
    });
    return Response.json(
      { error: "Failed to retry transcript AI jobs", detail },
      { status: 500 }
    );
  }
}
