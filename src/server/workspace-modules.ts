import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export const DEFAULT_WORKSPACE_KEY = "primary";

export type WorkspaceModuleFlags = {
  email: boolean;
  whatsapp: boolean;
  voice: boolean;
  aiAutomation: boolean;
  dexterOrchestration: boolean;
  vanillaWebchat: boolean;
};

export type WorkspaceModuleKey = keyof WorkspaceModuleFlags;

export type WorkspaceModulesConfig = {
  workspaceKey: string;
  tenantId: string;
  updatedAt: string | null;
  modules: WorkspaceModuleFlags;
  source?: "persisted" | "default" | "fail_closed";
  failureReason?: "missing_configuration" | "load_failed";
};

export const DEFAULT_WORKSPACE_MODULES: WorkspaceModuleFlags = {
  email: true,
  whatsapp: true,
  voice: true,
  aiAutomation: true,
  dexterOrchestration: true,
  vanillaWebchat: true
};

export const DISABLED_WORKSPACE_MODULES: WorkspaceModuleFlags = {
  email: false,
  whatsapp: false,
  voice: false,
  aiAutomation: false,
  dexterOrchestration: false,
  vanillaWebchat: false
};

function defaultWorkspaceConfig(workspaceKey: string, tenantId: string): WorkspaceModulesConfig {
  return {
    workspaceKey,
    tenantId,
    updatedAt: null,
    modules: { ...DEFAULT_WORKSPACE_MODULES },
    source: "default"
  };
}

function failClosedWorkspaceConfig(
  workspaceKey: string,
  tenantId: string,
  failureReason: WorkspaceModulesConfig["failureReason"]
): WorkspaceModulesConfig {
  return {
    workspaceKey,
    tenantId,
    updatedAt: null,
    modules: { ...DISABLED_WORKSPACE_MODULES },
    source: "fail_closed",
    failureReason
  };
}

function readBoolean(value: string | undefined | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function entitlementsFailClosed() {
  return readBoolean(process.env.ENTITLEMENTS_FAIL_CLOSED) ?? process.env.NODE_ENV === "production";
}

function coerceModuleState(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const enabled = (value as { enabled?: unknown }).enabled;
    if (typeof enabled !== "boolean") return fallback;
    if (!enabled) return false;
    const status = String((value as { status?: unknown }).status ?? "active").toLowerCase();
    return !["disabled", "inactive", "suspended", "canceled", "cancelled"].includes(status);
  }
  return fallback;
}

export function normalizeWorkspaceModules(input?: Partial<WorkspaceModuleFlags> | null): WorkspaceModuleFlags {
  return {
    email: coerceModuleState(input?.email, DEFAULT_WORKSPACE_MODULES.email),
    whatsapp: coerceModuleState(input?.whatsapp, DEFAULT_WORKSPACE_MODULES.whatsapp),
    voice: coerceModuleState(input?.voice, DEFAULT_WORKSPACE_MODULES.voice),
    aiAutomation: coerceModuleState(input?.aiAutomation, DEFAULT_WORKSPACE_MODULES.aiAutomation),
    dexterOrchestration: coerceModuleState(
      input?.dexterOrchestration,
      DEFAULT_WORKSPACE_MODULES.dexterOrchestration
    ),
    vanillaWebchat: coerceModuleState(input?.vanillaWebchat, DEFAULT_WORKSPACE_MODULES.vanillaWebchat)
  };
}

/**
 * Get workspace module flags for a tenant's workspace.
 *
 * v2: queries are tenant-scoped. tenantId defaults to DEFAULT_TENANT_ID
 * during the migration period for backward compatibility.
 */
export async function getWorkspaceModules(
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  tenantId = DEFAULT_TENANT_ID
): Promise<WorkspaceModulesConfig> {
  if ((process.env.NODE_ENV === "test" || process.env.VITEST === "true") && !entitlementsFailClosed()) {
    return defaultWorkspaceConfig(workspaceKey, tenantId);
  }

  let result:
    | {
        rows?: Array<{
          workspace_key: string;
          tenant_id: string;
          modules: Partial<WorkspaceModuleFlags> | null;
          updated_at: Date | string | null;
        }>;
      }
    | undefined;

  try {
    result = await db.query<{
      workspace_key: string;
      tenant_id: string;
      modules: Partial<WorkspaceModuleFlags> | null;
      updated_at: Date | string | null;
    }>(
      `SELECT workspace_key, tenant_id, modules, updated_at
       FROM workspace_modules
       WHERE workspace_key = $1 AND tenant_id = $2
       LIMIT 1`,
      [workspaceKey, tenantId]
    );
  } catch (error) {
    if (entitlementsFailClosed()) {
      logger.error("Workspace config load failed, failing closed", { error, workspaceKey, tenantId });
      return failClosedWorkspaceConfig(workspaceKey, tenantId, "load_failed");
    }
    logger.error("Workspace config load failed, using defaults", { error, workspaceKey, tenantId });
    return defaultWorkspaceConfig(workspaceKey, tenantId);
  }

  const row = result?.rows?.[0];
  if (!row) {
    if (entitlementsFailClosed()) {
      logger.warn("Workspace config missing, failing closed", { workspaceKey, tenantId });
      return failClosedWorkspaceConfig(workspaceKey, tenantId, "missing_configuration");
    }
    return defaultWorkspaceConfig(workspaceKey, tenantId);
  }

  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : typeof row.updated_at === "string"
        ? row.updated_at
        : null;

  return {
    workspaceKey: row.workspace_key,
    tenantId: row.tenant_id,
    updatedAt,
    modules: normalizeWorkspaceModules(row.modules),
    source: "persisted"
  };
}

/**
 * Save workspace module flags for a tenant's workspace.
 */
export async function saveWorkspaceModules(
  modules: Partial<WorkspaceModuleFlags>,
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  tenantId = DEFAULT_TENANT_ID
): Promise<WorkspaceModulesConfig> {
  const normalized = normalizeWorkspaceModules(modules);
  const result = await db.query<{
    workspace_key: string;
    tenant_id: string;
    modules: WorkspaceModuleFlags;
    updated_at: Date;
  }>(
    `INSERT INTO workspace_modules (workspace_key, tenant_id, modules, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (tenant_id, workspace_key)
     DO UPDATE SET modules = EXCLUDED.modules, updated_at = now()
     RETURNING workspace_key, tenant_id, modules, updated_at`,
    [workspaceKey, tenantId, JSON.stringify(normalized)]
  );

  return {
    workspaceKey: result.rows[0].workspace_key,
    tenantId: result.rows[0].tenant_id,
    updatedAt: result.rows[0].updated_at.toISOString(),
    modules: normalizeWorkspaceModules(result.rows[0].modules)
  };
}

async function isTenantRuntimeActiveForModules(tenantId: string) {
  try {
    const result = await db.query<{ status: string }>(
      `SELECT status::text
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      [tenantId]
    );
    const status = result.rows[0]?.status;
    if (!status) {
      logger.warn("Workspace module entitlement denied because tenant is missing", { tenantId });
      return false;
    }
    if (status !== "active") {
      logger.warn("Workspace module entitlement denied because tenant is not active", {
        tenantId,
        status
      });
      return false;
    }
    return true;
  } catch (error) {
    logger.error("Workspace module entitlement denied because tenant status check failed", {
      error,
      tenantId
    });
    return false;
  }
}

/**
 * Check if a specific module is enabled for a tenant's workspace.
 */
export async function isWorkspaceModuleEnabled(
  moduleKey: WorkspaceModuleKey,
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  tenantId = DEFAULT_TENANT_ID
) {
  if (!(await isTenantRuntimeActiveForModules(tenantId))) {
    return false;
  }
  const config = await getWorkspaceModules(workspaceKey, tenantId);
  return config.modules[moduleKey] === true;
}
