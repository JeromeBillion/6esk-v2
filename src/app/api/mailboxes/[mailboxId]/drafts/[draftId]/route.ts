import { getSessionUser } from "@/server/auth/session";
import { listInboxMailboxesForUser } from "@/server/mailboxes";
import { deleteMailDraft } from "@/server/email/drafts";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ mailboxId: string; draftId: string }> }
) {
  const { mailboxId, draftId } = await params;
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = user.tenant_id ?? DEFAULT_TENANT_ID;

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
