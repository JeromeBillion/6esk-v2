import { db } from "@/server/db";
import { recordAuditLogWithClient } from "@/server/audit";
import { DEFAULT_WORKSPACE_KEY, DEFAULT_WORKSPACE_MODULES } from "@/server/workspace-modules";

export type EntitlementDriftItem = {
  moduleKey: string;
  workspaceEnabled: boolean;
  entitlementEnabled: boolean | null;
};

export type EntitlementDriftReport = {
  tenantId: string;
  workspaceKey: string;
  checkedAt: string;
  drift: EntitlementDriftItem[];
};

function normalizeModuleMap(value: unknown) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    Object.keys(DEFAULT_WORKSPACE_MODULES).map((moduleKey) => [
      moduleKey,
      source[moduleKey] === true
    ])
  );
}

export async function getTenantEntitlementDrift(
  tenantId: string,
  workspaceKey = DEFAULT_WORKSPACE_KEY
): Promise<EntitlementDriftReport> {
  const workspaceResult = await db.query<{ modules: unknown }>(
    `SELECT modules
     FROM workspace_modules
     WHERE tenant_id = $1 AND workspace_key = $2
     LIMIT 1`,
    [tenantId, workspaceKey]
  );

  const workspaceModules = normalizeModuleMap(workspaceResult.rows[0]?.modules);

  const entitlementResult = await db.query<{ module_key: string; is_enabled: boolean }>(
    `SELECT module_key, is_enabled
     FROM tenant_entitlements
     WHERE tenant_id = $1`,
    [tenantId]
  );

  const entitlementMap = new Map<string, boolean>();
  for (const row of entitlementResult.rows) {
    entitlementMap.set(row.module_key, row.is_enabled === true);
  }

  const drift: EntitlementDriftItem[] = [];
  for (const [moduleKey, workspaceEnabled] of Object.entries(workspaceModules)) {
    const entitlementEnabled = entitlementMap.has(moduleKey)
      ? entitlementMap.get(moduleKey) ?? false
      : null;
    if (entitlementEnabled === null || entitlementEnabled !== workspaceEnabled) {
      drift.push({
        moduleKey,
        workspaceEnabled,
        entitlementEnabled
      });
    }
  }

  return {
    tenantId,
    workspaceKey,
    checkedAt: new Date().toISOString(),
    drift
  };
}

export async function repairTenantEntitlementDrift(
  tenantId: string,
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  options: { actorUserId?: string | null } = {}
) {
  const report = await getTenantEntitlementDrift(tenantId, workspaceKey);
  if (!report.drift.length) {
    return {
      repaired: 0,
      report
    };
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const item of report.drift) {
      await client.query(
        `INSERT INTO tenant_entitlements (tenant_id, module_key, is_enabled, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (tenant_id, module_key)
         DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now()`,
        [tenantId, item.moduleKey, item.workspaceEnabled]
      );
    }
    await recordAuditLogWithClient(client, {
      tenantId,
      actorUserId: options.actorUserId ?? null,
      action: "tenant_entitlement_drift_repaired",
      entityType: "tenant",
      entityId: tenantId,
      data: {
        workspaceKey: report.workspaceKey,
        repaired: report.drift.length,
        drift: report.drift
      }
    });
    await client.query("COMMIT");
    return {
      repaired: report.drift.length,
      report
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
