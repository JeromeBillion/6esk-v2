import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";

const createSchema = z.object({
  ruleType: z.enum(["allow", "block"]),
  scope: z.enum(["sender", "domain", "subject", "body"]),
  pattern: z.string().min(1)
});

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
    `SELECT id, rule_type, scope, pattern, is_active, created_at
     FROM spam_rules
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return Response.json({ rules: result.rows });
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

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `INSERT INTO spam_rules (rule_type, scope, pattern, tenant_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, rule_type, scope, pattern, is_active, created_at`,
    [parsed.data.ruleType, parsed.data.scope, parsed.data.pattern.toLowerCase(), tenantId]
  );

  await recordAuditLog({
    tenantId,
    actorUserId: user?.id ?? null,
    action: "spam_rule_created",
    entityType: "spam_rule",
    entityId: result.rows[0].id,
    data: { ruleType: parsed.data.ruleType, scope: parsed.data.scope }
  });

  return Response.json({ rule: result.rows[0] });
}
