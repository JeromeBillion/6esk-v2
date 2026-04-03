import { getSessionUser } from "@/server/auth/session";
import { listInboxMailboxesForUser } from "@/server/mailboxes";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mailboxes = await listInboxMailboxesForUser(user);
  return Response.json({ mailboxes });
}
