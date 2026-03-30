import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { getTranscriptJobMetrics } from "@/server/calls/transcript-jobs";
import { deliverPendingTranscriptJobs } from "@/server/calls/transcript-worker";

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const metrics = await getTranscriptJobMetrics();
  return Response.json(metrics);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const sharedSecret =
    process.env.CALLS_OUTBOX_SECRET ?? process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingTranscriptJobs({ limit });

    await recordAuditLog({
      actorUserId: user?.id ?? null,
      action: "call_transcript_outbox_triggered",
      entityType: "call_transcript_jobs",
      data: result
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run transcript outbox";
    await recordAuditLog({
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
