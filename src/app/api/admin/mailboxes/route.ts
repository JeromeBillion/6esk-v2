import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";

const createMailboxSchema = z.object({
  address: z.string().email(),
  memberEmails: z.array(z.string().email()).default([])
});

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT
        m.id,
        m.address,
        m.type,
        m.created_at,
        owner.email AS owner_email,
        COALESCE(
          json_agg(
            json_build_object(
              'id', member.id,
              'email', member.email,
              'displayName', member.display_name,
              'accessLevel', mm.access_level
            )
            ORDER BY member.email
          ) FILTER (WHERE member.id IS NOT NULL),
          '[]'::json
        ) AS members
     FROM mailboxes m
     LEFT JOIN users owner ON owner.id = m.owner_user_id
     LEFT JOIN mailbox_memberships mm ON mm.mailbox_id = m.id
     LEFT JOIN users member ON member.id = mm.user_id
     GROUP BY m.id, owner.email
     ORDER BY m.type, m.address`
  );

  return Response.json({ mailboxes: result.rows });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createMailboxSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const address = parsed.data.address.trim().toLowerCase();
  const memberEmails = [...new Set(parsed.data.memberEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];

  const existing = await db.query<{ id: string; type: "platform" | "personal" }>(
    "SELECT id, type FROM mailboxes WHERE address = $1 LIMIT 1",
    [address]
  );

  const existingMailbox = existing.rows[0] ?? null;
  if (existingMailbox && existingMailbox.type !== "platform") {
    return Response.json(
      { error: "Personal mailboxes are managed through user accounts.", code: "personal_mailbox_managed_via_users" },
      { status: 409 }
    );
  }

  let resolvedMembers: Array<{ id: string; email: string; display_name: string }> = [];
  if (memberEmails.length > 0) {
    const memberResult = await db.query<{ id: string; email: string; display_name: string }>(
      `SELECT id, email, display_name
       FROM users
       WHERE lower(email) = ANY($1::text[])
       ORDER BY email`,
      [memberEmails]
    );
    resolvedMembers = memberResult.rows;

    const resolvedSet = new Set(resolvedMembers.map((member) => member.email.toLowerCase()));
    const missingMembers = memberEmails.filter((email) => !resolvedSet.has(email));
    if (missingMembers.length > 0) {
      return Response.json(
        {
          error: "Some member emails do not match existing users.",
          code: "unknown_mailbox_members",
          missingMembers
        },
        { status: 400 }
      );
    }
  }

  const mailboxResult = await db.query<{ id: string; address: string; type: "platform"; created_at: string }>(
    `INSERT INTO mailboxes (type, address, owner_user_id)
     VALUES ('platform', $1, NULL)
     ON CONFLICT (address) DO UPDATE SET address = EXCLUDED.address
     RETURNING id, address, type, created_at`,
    [address]
  );
  const mailbox = mailboxResult.rows[0];

  await db.query("DELETE FROM mailbox_memberships WHERE mailbox_id = $1", [mailbox.id]);
  for (const member of resolvedMembers) {
    await db.query(
      `INSERT INTO mailbox_memberships (mailbox_id, user_id, access_level)
       VALUES ($1, $2, 'member')`,
      [mailbox.id, member.id]
    );
  }

  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: existingMailbox ? "mailbox_updated" : "mailbox_created",
    entityType: "mailbox",
    entityId: mailbox.id,
    data: {
      address,
      type: "platform",
      memberEmails
    }
  });

  return Response.json({
    status: existingMailbox ? "updated" : "created",
    mailbox: {
      ...mailbox,
      owner_email: null,
      members: resolvedMembers.map((member) => ({
        id: member.id,
        email: member.email,
        displayName: member.display_name,
        accessLevel: "member"
      }))
    }
  });
}
