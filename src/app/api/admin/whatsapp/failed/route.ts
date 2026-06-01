import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { listFailedWhatsAppOutboxEvents } from "@/server/whatsapp/outbox";
import { tenantScopeFromUser } from "@/server/tenant-context";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const scope = tenantScopeFromUser(user);

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const events = await listFailedWhatsAppOutboxEvents(limit, scope);
  return Response.json({ events });
}
