import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { listFailedWhatsAppOutboxEvents } from "@/server/whatsapp/outbox";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);
  const tenantId = user?.tenant_id ?? DEFAULT_TENANT_ID;

  const events = await listFailedWhatsAppOutboxEvents(limit, tenantId);
  return Response.json({ events });
}
