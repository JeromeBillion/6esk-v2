import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { listFailedTranscriptAiJobs } from "@/server/calls/transcript-ai-jobs";

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;
  const { scope } = access;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30) || 30, 1), 100);
  const jobs = await listFailedTranscriptAiJobs(limit, scope);
  return Response.json({ jobs });
}
