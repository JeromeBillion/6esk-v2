import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { listInboxMailboxesForUser } from "@/server/mailboxes";
import { deleteMailDraft } from "@/server/email/drafts";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ mailboxId: string; draftId: string }> }
) {
  const { mailboxId, draftId } = await params;
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const mailboxes = await listInboxMailboxesForUser(user);
  const mailbox = mailboxes.find((entry) => entry.id === mailboxId);
  if (!mailbox) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const deleted = await deleteMailDraft(draftId, tenantId, mailboxId);
  if (!deleted) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }

  return Response.json({ status: "deleted", id: draftId });
}
