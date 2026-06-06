import { z } from "zod";
import { getSessionContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { redactCallData } from "@/server/calls/redaction";
import {
  privilegedAccessErrorResponse,
  resolveTenantDataAccess
} from "@/server/auth/privileged-access-authorization";

const querySchema = z.object({
  limit: z.number().int().min(1).max(200).optional()
});

export async function GET(request: Request) {
  const context = await getSessionContext();
  let access;
  try {
    access = await resolveTenantDataAccess(request, context?.user ?? null, {
      operation: "tenant_audit_log_read",
      accessTypes: ["support", "break_glass"],
      authProvider: context?.authProvider ?? null
    });
  } catch (error) {
    const response = privilegedAccessErrorResponse(error);
    if (response) return response;
    throw error;
  }
  const scope = access.scope;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const parsed = querySchema.safeParse({ limit: limitParam });
  const limit = parsed.success ? parsed.data.limit ?? 50 : 50;

  const result = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.data, a.created_at,
            u.display_name as actor_name, u.email as actor_email
     FROM audit_logs a
     LEFT JOIN users u
       ON u.id = a.actor_user_id
      AND u.tenant_key = a.tenant_key
      AND u.workspace_key = a.workspace_key
     WHERE a.tenant_key = $1
       AND a.workspace_key = $2
     ORDER BY a.created_at DESC
     LIMIT $3`,
    [scope.tenantKey, scope.workspaceKey, limit]
  );

  return Response.json({
    logs: result.rows.map((row) => ({
      ...row,
      data: redactCallData(row.data ?? null)
    }))
  });
}
