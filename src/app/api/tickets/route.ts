import { getSessionUser } from "@/server/auth/session";
import { listTicketsForUser } from "@/server/tickets";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tickets = await listTicketsForUser(user);
  return Response.json({ tickets });
}
