import { db } from "@/server/db";
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
};

export const DEFAULT_WORKSPACE_MODULES: WorkspaceModuleFlags = {
  email: true,
  whatsapp: true,
  voice: true,
  aiAutomation: true,
  dexterOrchestration: true,
  vanillaWebchat: true
};

function defaultWorkspaceConfig(workspaceKey: string, tenantId: string): WorkspaceModulesConfig {
  return {
    workspaceKey,
    tenantId,
    updatedAt: null,
    modules: { ...DEFAULT_WORKSPACE_MODULES }
  };
}

function coerceBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeWorkspaceModules(input?: Partial<WorkspaceModuleFlags> | null): WorkspaceModuleFlags {
  return {
    email: coerceBoolean(input?.email, DEFAULT_WORKSPACE_MODULES.email),
    whatsapp: coerceBoolean(input?.whatsapp, DEFAULT_WORKSPACE_MODULES.whatsapp),
    voice: coerceBoolean(input?.voice, DEFAULT_WORKSPACE_MODULES.voice),
    aiAutomation: coerceBoolean(input?.aiAutomation, DEFAULT_WORKSPACE_MODULES.aiAutomation),
    dexterOrchestration: coerceBoolean(
      input?.dexterOrchestration,
      DEFAULT_WORKSPACE_MODULES.dexterOrchestration
    ),
    vanillaWebchat: coerceBoolean(input?.vanillaWebchat, DEFAULT_WORKSPACE_MODULES.vanillaWebchat)
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
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
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
  } catch {
    return defaultWorkspaceConfig(workspaceKey, tenantId);
  }

  const row = result?.rows?.[0];
  if (!row) {
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
    modules: normalizeWorkspaceModules(row.modules)
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

/**
 * Check if a specific module is enabled for a tenant's workspace.
 */
export async function isWorkspaceModuleEnabled(
  moduleKey: WorkspaceModuleKey,
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  tenantId = DEFAULT_TENANT_ID
) {
  const config = await getWorkspaceModules(workspaceKey, tenantId);
  return config.modules[moduleKey] === true;
}
