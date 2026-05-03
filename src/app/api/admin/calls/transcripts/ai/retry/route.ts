import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { retryFailedTranscriptAiJobs } from "@/server/calls/transcript-ai-jobs";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const sharedSecret =
    process.env.CALLS_OUTBOX_SECRET ?? process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 25) || 25, 1), 100);
  const body = (await request.json().catch(() => ({}))) as { jobIds?: string[] };

  try {
    const result = await retryFailedTranscriptAiJobs({
      limit,
      jobIds: Array.isArray(body.jobIds) ? body.jobIds : undefined
    });
    await recordAuditLog({
      tenantId: user?.tenant_id ?? DEFAULT_TENANT_ID,
      actorUserId: user?.id ?? null,
      action: "call_transcript_ai_retry_triggered",
      entityType: "call_transcript_ai_jobs",
      data: result
    });
    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to retry transcript AI jobs";
    await recordAuditLog({
      tenantId: user?.tenant_id ?? DEFAULT_TENANT_ID,
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
