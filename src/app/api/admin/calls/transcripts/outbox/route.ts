import {
  requireLeadAdminAccess,
  requireLeadAdminOrMachineAccess
} from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { getTranscriptJobMetrics } from "@/server/calls/transcript-jobs";
import { deliverPendingTranscriptJobs } from "@/server/calls/transcript-worker";

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const metrics = await getTranscriptJobMetrics(access.scope);
  return Response.json(metrics);
}

export async function POST(request: Request) {
  const access = await requireLeadAdminOrMachineAccess(request, {
    secretEnvNames: ["CALLS_OUTBOX_SECRET", "INBOUND_SHARED_SECRET"]
  });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingTranscriptJobs({ limit }, scope);

    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_transcript_outbox_triggered",
      entityType: "call_transcript_jobs",
      data: result
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run transcript outbox";
    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "call_transcript_outbox_trigger_failed",
      entityType: "call_transcript_jobs",
      data: {
        limit,
        detail
      }
    }).catch(() => {});
    return Response.json({ error: "Failed to run transcript outbox", detail }, { status: 500 });
  }
}
