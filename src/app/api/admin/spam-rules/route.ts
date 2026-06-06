import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";

const createSchema = z.object({
  ruleType: z.enum(["allow", "block"]),
  scope: z.enum(["sender", "domain", "subject", "body"]),
  pattern: z.string().min(1)
});

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;
  const { scope } = access;

  const result = await db.query(
    `SELECT id, rule_type, scope, pattern, is_active, created_at
     FROM spam_rules
     WHERE tenant_key = $1
       AND workspace_key = $2
     ORDER BY created_at DESC`,
    [scope.tenantKey, scope.workspaceKey]
  );
  return Response.json({ rules: result.rows });
}

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

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

  const result = await db.query(
    `INSERT INTO spam_rules (tenant_key, workspace_key, rule_type, scope, pattern)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, rule_type, scope, pattern, is_active, created_at`,
    [
      scope.tenantKey,
      scope.workspaceKey,
      parsed.data.ruleType,
      parsed.data.scope,
      parsed.data.pattern.toLowerCase()
    ]
  );

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "spam_rule_created",
    entityType: "spam_rule",
    entityId: result.rows[0].id,
    data: { ruleType: parsed.data.ruleType, scope: parsed.data.scope }
  });

  return Response.json({ rule: result.rows[0] });
}
