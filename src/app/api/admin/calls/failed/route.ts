import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { listFailedCallOutboxEvents } from "@/server/calls/outbox";
import { redactCallData } from "@/server/calls/redaction";

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;
  const { scope } = access;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const events = await listFailedCallOutboxEvents(limit, scope);
  return Response.json({
    events: events.map((event) => redactCallData(event))
  });
}
