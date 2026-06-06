import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { listFailedWhatsAppOutboxEvents } from "@/server/whatsapp/outbox";

export async function GET(request: Request) {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;
  const { scope } = access;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const events = await listFailedWhatsAppOutboxEvents(limit, scope);
  return Response.json({ events });
}
