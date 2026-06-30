import { z } from "zod";
import { db } from "@/server/db";
import {
  requireBackofficeSensitiveAccess,
  requireBackofficeStaff
} from "@/server/backoffice/authz";
import { getTenantById } from "@/server/tenant/lifecycle";
import { recordAuditLogWithClient } from "@/server/audit";

const updateModulesSchema = z.object({
  modules: z.record(z.boolean())
});

const paramsSchema = z.object({
  tenantId: z.string().uuid()
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const auth = await requireBackofficeStaff(request.headers);
  if (!auth.ok) return auth.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { tenantId } = parsedParams.data;
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  const result = await db.query(
    `SELECT modules FROM workspace_modules WHERE tenant_id = $1 AND workspace_key = 'primary' LIMIT 1`,
    [tenantId]
  );
  
  if (result.rows.length === 0) {
    return Response.json({ error: "Workspace modules not found" }, { status: 404 });
  }

  return Response.json({ modules: result.rows[0].modules });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const auth = await requireBackofficeSensitiveAccess(request.headers);
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateModulesSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { tenantId } = parsedParams.data;
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    
    // Fetch current to merge
    const current = await client.query(
      `SELECT modules FROM workspace_modules WHERE tenant_id = $1 AND workspace_key = 'primary' LIMIT 1`,
      [tenantId]
    );

    if (current.rows.length === 0) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Workspace modules not found" }, { status: 404 });
    }

    const merged = {
      ...(current.rows[0].modules as Record<string, boolean>),
      ...parsed.data.modules
    };

    // Update workspace_modules
    await client.query(
      `UPDATE workspace_modules
       SET modules = $1::jsonb, updated_at = now()
       WHERE tenant_id = $2 AND workspace_key = 'primary'`,
      [JSON.stringify(merged), tenantId]
    );

    // Sync tenant_entitlements
    for (const [moduleKey, isEnabled] of Object.entries(merged)) {
      if (isEnabled) {
        await client.query(
          `INSERT INTO tenant_entitlements (tenant_id, module_key, is_enabled)
           VALUES ($1, $2, true)
           ON CONFLICT (tenant_id, module_key) DO UPDATE SET is_enabled = true`,
          [tenantId, moduleKey]
        );
      } else {
        await client.query(
          `UPDATE tenant_entitlements SET is_enabled = false WHERE tenant_id = $1 AND module_key = $2`,
          [tenantId, moduleKey]
        );
      }
    }

    await recordAuditLogWithClient(client, {
      tenantId,
      actorUserId: auth.user.id,
      action: "tenant_modules_updated",
      entityType: "tenant",
      entityId: tenantId,
      data: { modules: merged }
    });
    await client.query("COMMIT");

    return Response.json({ modules: merged });
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
