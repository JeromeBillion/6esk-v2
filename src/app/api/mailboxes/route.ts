import { getSessionUser } from "@/server/auth/session";
import { listMailboxesForUser } from "@/server/mailboxes";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mailboxes = await listMailboxesForUser(user);
  return Response.json({ mailboxes });
}
