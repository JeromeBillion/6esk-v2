import { getSessionUser } from "@/server/auth/session";
import { listTicketsForUser } from "@/server/tickets";
import { isLeadAdmin } from "@/server/auth/roles";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const priority = url.searchParams.get("priority");
  const tag = url.searchParams.get("tag");
  const search = url.searchParams.get("q");
  const assigned = url.searchParams.get("assigned");
  const channel = url.searchParams.get("channel");

  const assignedUserId =
    isLeadAdmin(user) && assigned === "mine" ? user.id : undefined;

  const tickets = await listTicketsForUser(user, {
    status: status === "all" ? null : status,
    priority: priority === "all" ? null : priority,
    tag: tag === "all" ? null : tag,
    search: search && search.trim() ? search.trim() : null,
    assignedUserId,
    channel: channel === "all" ? null : channel
  });
  return Response.json({ tickets });
}
