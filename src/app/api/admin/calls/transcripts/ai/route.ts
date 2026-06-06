import {
  requireLeadAdminAccess,
  requireLeadAdminOrMachineAccess
} from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { getTranscriptAiJobMetrics } from "@/server/calls/transcript-ai-jobs";
import { deliverPendingTranscriptAiJobs } from "@/server/calls/transcript-ai-worker";

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), 25);
  const metrics = await getTranscriptAiJobMetrics(limit, access.scope);
  return Response.json(metrics);
}

export async function POST(request: Request) {
  const access = await requireLeadAdminOrMachineAccess(request, {
    secretEnvNames: ["CALLS_OUTBOX_SECRET", "INBOUND_SHARED_SECRET"]
  });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingTranscriptAiJobs({ limit }, scope);
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_transcript_ai_outbox_triggered",
      entityType: "call_transcript_ai_jobs",
      data: result
    });
    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run transcript AI outbox";
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_transcript_ai_outbox_trigger_failed",
      entityType: "call_transcript_ai_jobs",
      data: {
        limit,
        detail
      }
    }).catch(() => {});
    return Response.json(
      { error: "Failed to run transcript AI outbox", detail },
      { status: 500 }
    );
  }
}
