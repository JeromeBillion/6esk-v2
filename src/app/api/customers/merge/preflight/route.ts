import { z } from "zod";
import { canManageTickets } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { MergeError, preflightCustomerMerge } from "@/server/merges";

const preflightSchema = z.object({
  sourceCustomerId: z.string().uuid(),
  targetCustomerId: z.string().uuid()
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

  if (parsed.data.sourceCustomerId === parsed.data.targetCustomerId) {
    return Response.json(
      {
        error: "Source and target customers must be different.",
        code: "invalid_input"
      },
      { status: 400 }
    );
  }

  try {
    const preflight = await preflightCustomerMerge({
      sourceCustomerId: parsed.data.sourceCustomerId,
      targetCustomerId: parsed.data.targetCustomerId
    });
    return Response.json({ preflight });
  } catch (error) {
    if (error instanceof MergeError) {
      const status =
        error.code === "not_found" ? 404 : error.code === "invalid_input" ? 400 : 409;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    const message = error instanceof Error ? error.message : "Failed to preflight customer merge";
    return Response.json({ error: message }, { status: 500 });
  }
}
