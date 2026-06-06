import { z } from "zod";
import { db } from "@/server/db";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { hashPassword } from "@/server/auth/password";
import { recordAuditLog } from "@/server/audit";

const createUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  password: z.string().min(8),
  roleId: z.string().uuid()
});

export async function GET() {
  const auth = await requireLeadAdminAccess();
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  const result = await db.query(
    `SELECT u.id, u.email, u.display_name, u.is_active, u.created_at,
            r.id as role_id, r.name as role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.tenant_key = $1
     ORDER BY u.created_at DESC`
    ,
    [scope.tenantKey]
  );

  return Response.json({ users: result.rows });
}

export async function POST(request: Request) {
  const auth = await requireLeadAdminAccess({ requireMfa: true });
  if (!auth.ok) return auth.response;
  const { user, scope } = auth;

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
    "SELECT id, role_id FROM users WHERE tenant_key = $1 AND email = $2 LIMIT 1",
    [scope.tenantKey, emailLower]
  );
  const existingUser = existing.rows[0] ?? null;
  const passwordHash = hashPassword(password);

  const result = await db.query(
    `INSERT INTO users (tenant_key, workspace_key, email, display_name, password_hash, role_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_key, email) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash,
       role_id = EXCLUDED.role_id
     RETURNING id, email, display_name, role_id`,
    [scope.tenantKey, scope.workspaceKey, emailLower, displayName, passwordHash, roleId]
  );

  const created = result.rows[0];

  await db.query(
    `INSERT INTO mailboxes (tenant_key, workspace_key, type, address, owner_user_id)
     VALUES ($1, $2, 'personal', $3, $4)
     ON CONFLICT (tenant_key, address) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id`,
    [scope.tenantKey, scope.workspaceKey, created.email, created.id]
  );

  await db.query(
    `INSERT INTO mailbox_memberships (tenant_key, workspace_key, mailbox_id, user_id, access_level)
     SELECT $1, $2, id, $3, 'owner' FROM mailboxes WHERE tenant_key = $1 AND address = $4
     ON CONFLICT (mailbox_id, user_id) DO NOTHING`,
    [scope.tenantKey, scope.workspaceKey, created.id, created.email]
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
