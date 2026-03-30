import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { getTranscriptAiJobMetrics } from "@/server/calls/transcript-ai-jobs";
import { deliverPendingTranscriptAiJobs } from "@/server/calls/transcript-ai-worker";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1), 25);
  const metrics = await getTranscriptAiJobMetrics(limit);
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
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingTranscriptAiJobs({ limit });
    await recordAuditLog({
      actorUserId: user?.id ?? null,
      action: "call_transcript_ai_outbox_triggered",
      entityType: "call_transcript_ai_jobs",
      data: result
    });
    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run transcript AI outbox";
    await recordAuditLog({
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
