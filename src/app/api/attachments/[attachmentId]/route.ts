import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { getObjectBuffer } from "@/server/storage/r2";
import { getTicketAssignment, hasMailboxAccess } from "@/server/messages";
import { resolveMockAttachment } from "@/app/lib/mock-attachments";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const { attachmentId } = await params;
  const mockAttachment = resolveMockAttachment(attachmentId);
  if (mockAttachment) {
    return new Response(mockAttachment.body, {
      headers: {
        "Content-Type": mockAttachment.contentType,
        "Content-Disposition": `attachment; filename="${mockAttachment.filename}"`
      }
    });
  }

  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await db.query(
    `SELECT a.id, a.filename, a.content_type, a.r2_key, m.mailbox_id, m.ticket_id
     FROM attachments a
     JOIN messages m ON m.id = a.message_id
     WHERE a.id = $1`,
    [attachmentId]
  );

  const attachment = result.rows[0];
  if (!attachment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const isAdmin = isLeadAdmin(user);
  if (!isAdmin) {
    if (attachment.ticket_id) {
      const assignedUserId = await getTicketAssignment(attachment.ticket_id);
      if (!assignedUserId || assignedUserId !== user.id) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      const allowed = await hasMailboxAccess(user.id, attachment.mailbox_id);
      if (!allowed) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const { buffer, contentType } = await getObjectBuffer(attachment.r2_key);

  const requestUrl = new URL(request.url);
  const requestedDisposition = requestUrl.searchParams.get("disposition");
  const disposition =
    requestedDisposition === "inline" || requestedDisposition === "attachment"
      ? requestedDisposition
      : "attachment";

  return new Response(buffer, {
    headers: {
      "Content-Type": contentType ?? "application/octet-stream",
      "Content-Disposition": `${disposition}; filename=\"${attachment.filename}\"`
    }
  });
}
