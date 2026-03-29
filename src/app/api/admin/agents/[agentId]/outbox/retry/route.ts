import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { recordAuditLog } from "@/server/audit";
import { retryFailedAgentEvents } from "@/server/agents/outbox";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId } = await params;
  const integration = await getAgentIntegrationById(agentId);
  if (!integration) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 25) || 25, 1), 100);
  let eventIds: string[] = [];
  try {
    const payload = (await request.json()) as { eventIds?: unknown };
    if (Array.isArray(payload?.eventIds)) {
      eventIds = payload.eventIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 100);
    }
  } catch {
    eventIds = [];
  }

  try {
    const result = await retryFailedAgentEvents({
      integrationId: agentId,
      limit,
      eventIds
    });

    await recordAuditLog({
      actorUserId: user?.id ?? null,
      action: "agent_outbox_retry_triggered",
      entityType: "agent_integration",
      entityId: agentId,
      data: {
        limit,
        eventIdsCount: eventIds.length,
        retried: result.retried
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to retry failed agent outbox events";
    await recordAuditLog({
      actorUserId: user?.id ?? null,
      action: "agent_outbox_retry_failed",
      entityType: "agent_integration",
      entityId: agentId,
      data: {
        limit,
        detail
      }
    }).catch(() => {});
    return Response.json(
      { error: "Failed to retry failed agent outbox events", detail },
      { status: 500 }
    );
  }
}
