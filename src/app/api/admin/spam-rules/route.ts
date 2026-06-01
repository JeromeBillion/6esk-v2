import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";
import { tenantScopeFromUser } from "@/server/tenant-context";

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
  const scope = tenantScopeFromUser(user);

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
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const scope = tenantScopeFromUser(user);

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
