import { z } from "zod";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { MergeError, preflightTicketMerge } from "@/server/merges";
import { getTicketById } from "@/server/tickets";

const preflightSchema = z.object({
  sourceTicketId: z.string().uuid(),
  targetTicketId: z.string().uuid()
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = preflightSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { sourceTicketId, targetTicketId } = parsed.data;
  if (sourceTicketId === targetTicketId) {
    return Response.json(
      {
        error: "Source and target tickets must be different.",
        code: "invalid_input"
      },
      { status: 400 }
    );
  }

  const [source, target] = await Promise.all([
    getTicketById(sourceTicketId),
    getTicketById(targetTicketId)
  ]);

  if (!source || !target) {
    return Response.json({ error: "Source or target ticket not found" }, { status: 404 });
  }

  if (
    !isLeadAdmin(user) &&
    (source.assigned_user_id !== user.id || target.assigned_user_id !== user.id)
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const preflight = await preflightTicketMerge({
      sourceTicketId,
      targetTicketId
    });
    return Response.json({ preflight });
  } catch (error) {
    if (error instanceof MergeError) {
      const status =
        error.code === "not_found" ? 404 : error.code === "invalid_input" ? 400 : 409;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    const message = error instanceof Error ? error.message : "Failed to preflight ticket merge";
    return Response.json({ error: message }, { status: 500 });
  }
}
