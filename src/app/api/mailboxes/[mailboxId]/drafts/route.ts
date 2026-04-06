import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { listInboxMailboxesForUser } from "@/server/mailboxes";
import { upsertMailDraft } from "@/server/email/drafts";

const mailboxDraftSchema = z.object({
  draftId: z.string().uuid().optional().nullable(),
  to: z.array(z.string()).optional().nullable(),
  cc: z.array(z.string()).optional().nullable(),
  bcc: z.array(z.string()).optional().nullable(),
  subject: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  threadId: z.string().optional().nullable(),
  inReplyTo: z.string().optional().nullable(),
  references: z.array(z.string()).optional().nullable()
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ mailboxId: string }> }
) {
  const { mailboxId } = await params;
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mailboxes = await listInboxMailboxesForUser(user);
  const mailbox = mailboxes.find((entry) => entry.id === mailboxId);
  if (!mailbox) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = mailboxDraftSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const draft = await upsertMailDraft({
      draftId: parsed.data.draftId ?? null,
      mailboxId,
      fromEmail: mailbox.address,
      to: parsed.data.to ?? null,
      cc: parsed.data.cc ?? null,
      bcc: parsed.data.bcc ?? null,
      subject: parsed.data.subject ?? null,
      text: parsed.data.text ?? null,
      html: parsed.data.html ?? null,
      threadId: parsed.data.threadId ?? null,
      inReplyTo: parsed.data.inReplyTo ?? null,
      references: parsed.data.references ?? null
    });

    return Response.json({ draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save draft";
    const status = message === "Draft not found" ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
