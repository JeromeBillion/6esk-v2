import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { hashPassword } from "@/server/auth/password";
import { recordAuditLog } from "@/server/audit";

const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  password: z.string().min(8),
  roleId: z.string().uuid()
});

async function roleExistsForTenant(roleId: string, tenantId: string) {
  const result = await db.query("SELECT id FROM roles WHERE id = $1 AND tenant_id = $2 LIMIT 1", [
    roleId,
    tenantId
  ]);
  return result.rows.length > 0;
}

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT u.id, u.email, u.display_name, u.is_active, u.created_at,
            r.id as role_id, r.name as role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id
     WHERE u.tenant_id = $1
     ORDER BY u.created_at DESC`,
    [tenantId]
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
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const roleIsValid = await roleExistsForTenant(roleId, tenantId);
  if (!roleIsValid) {
    return Response.json({ error: "Invalid role" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const client = await db.connect();
  let created: { id: string; email: string; display_name: string; role_id: string };
  let existingUser: { id: string; role_id: string | null } | null = null;
  try {
    await client.query("BEGIN");

    const existingMailbox = await client.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM mailboxes WHERE address = $1 LIMIT 1",
      [emailLower]
    );
    if (existingMailbox.rows[0] && existingMailbox.rows[0].tenant_id !== tenantId) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Mailbox address belongs to another tenant" }, { status: 409 });
    }

    const existing = await client.query(
      "SELECT id, role_id FROM users WHERE email = $1 AND tenant_id = $2 LIMIT 1",
      [emailLower, tenantId]
    );
    existingUser = existing.rows[0] ?? null;

    const result = await client.query(
      `INSERT INTO users (email, display_name, password_hash, role_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         password_hash = EXCLUDED.password_hash,
         role_id = EXCLUDED.role_id
       WHERE users.tenant_id = EXCLUDED.tenant_id
       RETURNING id, email, display_name, role_id`,
      [emailLower, displayName, passwordHash, roleId, tenantId]
    );

    const createdRow = result.rows[0];
    if (!createdRow) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Email belongs to another tenant" }, { status: 409 });
    }
    created = createdRow;

    const mailboxResult = await client.query<{ id: string }>(
      `INSERT INTO mailboxes (type, address, owner_user_id, tenant_id)
       VALUES ('personal', $1, $2, $3)
       ON CONFLICT (address) DO UPDATE SET
         owner_user_id = EXCLUDED.owner_user_id
       WHERE mailboxes.tenant_id = EXCLUDED.tenant_id
       RETURNING id`,
      [created.email, created.id, tenantId]
    );
    const mailbox = mailboxResult.rows[0];
    if (!mailbox) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Mailbox address belongs to another tenant" }, { status: 409 });
    }

    await client.query(
      `INSERT INTO mailbox_memberships (tenant_id, mailbox_id, user_id, access_level)
       VALUES ($3, $2, $1, 'owner')
       ON CONFLICT (mailbox_id, user_id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         access_level = EXCLUDED.access_level`,
      [created.id, mailbox.id, tenantId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (existingUser) {
    const roleChanged = existingUser.role_id !== created.role_id;
    await recordAuditLog({
      tenantId,
      actorUserId: user?.id ?? null,
      action: roleChanged ? "user_role_updated" : "user_updated",
      entityType: "user",
      entityId: created.id,
      data: { email: created.email, roleId: created.role_id }
    });
  } else {
    await recordAuditLog({
      tenantId,
      actorUserId: user?.id ?? null,
      action: "user_created",
      entityType: "user",
      entityId: created.id,
      data: { email: created.email, roleId: created.role_id }
    });
  }

  return Response.json({ status: "created", user: created });
}
