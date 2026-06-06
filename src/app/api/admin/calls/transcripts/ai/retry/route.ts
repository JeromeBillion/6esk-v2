import { requireLeadAdminOrMachineAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { retryFailedTranscriptAiJobs } from "@/server/calls/transcript-ai-jobs";

export async function POST(request: Request) {
  const access = await requireLeadAdminOrMachineAccess(request, {
    secretEnvNames: ["CALLS_OUTBOX_SECRET", "INBOUND_SHARED_SECRET"]
  });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25) || 25, 1), 100);
  const body = (await request.json().catch(() => ({}))) as { jobIds?: string[] };

  try {
    const result = await retryFailedTranscriptAiJobs({
      limit,
      jobIds: Array.isArray(body.jobIds) ? body.jobIds : undefined
    }, scope);
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_transcript_ai_retry_triggered",
      entityType: "call_transcript_ai_jobs",
      data: result
    });
    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to retry transcript AI jobs";
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_transcript_ai_retry_failed",
      entityType: "call_transcript_ai_jobs",
      data: {
        limit,
        detail
      }
    }).catch(() => {});
    return Response.json(
      { error: "Failed to retry transcript AI jobs", detail },
      { status: 500 }
    );
  }
}
