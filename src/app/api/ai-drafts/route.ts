import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { listPendingDraftsForUser } from "@/server/agents/drafts";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("q");
  const channel = url.searchParams.get("channel");
  const assigned = url.searchParams.get("assigned");

  const assignedUserId =
    isLeadAdmin(user) && assigned === "mine" ? user.id : undefined;

  const drafts = await listPendingDraftsForUser(user, {
    search: search && search.trim() ? search.trim() : null,
    channel: channel === "all" ? null : channel,
    assignedUserId
  });

  return Response.json({ drafts });
}
