import { getSessionUser } from "@/server/auth/session";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import {
  listMergeReviewTasksForUser,
  type MergeReviewStatus
} from "@/server/merge-reviews";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const statusParam = (url.searchParams.get("status") ?? "pending").trim().toLowerCase();
  const search = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 200);
  const assigned = url.searchParams.get("assigned");

  const allowedStatuses = new Set(["pending", "approved", "rejected", "applied", "failed", "all"]);
  const status = allowedStatuses.has(statusParam)
    ? (statusParam as MergeReviewStatus | "all")
    : "pending";

  const assignedUserId =
    isLeadAdmin(user) && assigned === "mine" ? user.id : undefined;

  const reviews = await listMergeReviewTasksForUser(user, {
    status,
    search: search || null,
    limit,
    assignedUserId
  });

  return Response.json({ reviews });
}
