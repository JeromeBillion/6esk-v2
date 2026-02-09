import { db } from "@/server/db";
import { getAgentFromRequest } from "@/server/agents/auth";
import { getObjectBuffer } from "@/server/storage/r2";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const integration = await getAgentFromRequest(request);
  if (!integration) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (integration.status !== "active") {
    return Response.json({ error: "Integration paused" }, { status: 403 });
  }

  const { threadId } = await params;
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);

  const scopes = integration.scopes ?? {};
  const mailboxIds = Array.isArray((scopes as { mailbox_ids?: unknown }).mailbox_ids)
    ? ((scopes as { mailbox_ids: string[] }).mailbox_ids as string[])
    : [];

  const values: Array<string | number | string[]> = [threadId, limit];
  let mailboxFilter = "";
  if (mailboxIds.length) {
    values.push(mailboxIds);
    mailboxFilter = `AND mailbox_id = ANY($3)`;
  }

  const result = await db.query(
    `SELECT id, direction, origin, from_email, to_emails, subject,
            received_at, sent_at, r2_key_text, r2_key_html
     FROM messages
     WHERE thread_id = $1
     ${mailboxFilter}
     ORDER BY COALESCE(received_at, sent_at, created_at) ASC
     LIMIT $2`,
    values
  );

  const messages = await Promise.all(
    result.rows.map(async (row) => {
      let text: string | null = null;
      let html: string | null = null;

      if (row.r2_key_text) {
        const { buffer } = await getObjectBuffer(row.r2_key_text);
        text = buffer.toString("utf-8");
      }

      if (row.r2_key_html) {
        const { buffer } = await getObjectBuffer(row.r2_key_html);
        html = buffer.toString("utf-8");
      }

      return {
        id: row.id,
        direction: row.direction,
        origin: row.origin,
        from: row.from_email,
        to: row.to_emails,
        subject: row.subject,
        receivedAt: row.received_at,
        sentAt: row.sent_at,
        text,
        html
      };
    })
  );

  return Response.json({ threadId, messages });
}
