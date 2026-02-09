import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { hashPassword } from "@/server/auth/password";
import { recordAuditLog } from "@/server/audit";

const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  password: z.string().min(8),
  roleId: z.string().uuid()
});

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT u.id, u.email, u.display_name, u.is_active, u.created_at,
            r.id as role_id, r.name as role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     ORDER BY u.created_at DESC`
  );

  return Response.json({ users: result.rows });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { email, displayName, password, roleId } = parsed.data;
  const emailLower = email.toLowerCase();
  const existing = await db.query(
    "SELECT id, role_id FROM users WHERE email = $1 LIMIT 1",
    [emailLower]
  );
  const existingUser = existing.rows[0] ?? null;
  const passwordHash = hashPassword(password);

  const result = await db.query(
    `INSERT INTO users (email, display_name, password_hash, role_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash,
       role_id = EXCLUDED.role_id
     RETURNING id, email, display_name, role_id`,
    [emailLower, displayName, passwordHash, roleId]
  );

  const created = result.rows[0];

  await db.query(
    `INSERT INTO mailboxes (type, address, owner_user_id)
     VALUES ('personal', $1, $2)
     ON CONFLICT (address) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id`,
    [created.email, created.id]
  );

  await db.query(
    `INSERT INTO mailbox_memberships (mailbox_id, user_id, access_level)
     SELECT id, $1, 'owner' FROM mailboxes WHERE address = $2
     ON CONFLICT (mailbox_id, user_id) DO NOTHING`,
    [created.id, created.email]
  );

  if (existingUser) {
    const roleChanged = existingUser.role_id !== created.role_id;
    await recordAuditLog({
      actorUserId: user?.id ?? null,
      action: roleChanged ? "user_role_updated" : "user_updated",
      entityType: "user",
      entityId: created.id,
      data: { email: created.email, roleId: created.role_id }
    });
  } else {
    await recordAuditLog({
      actorUserId: user?.id ?? null,
      action: "user_created",
      entityType: "user",
      entityId: created.id,
      data: { email: created.email, roleId: created.role_id }
    });
  }

  return Response.json({ status: "created", user: created });
}
