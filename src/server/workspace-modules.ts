import { db } from "@/server/db";

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

function defaultWorkspaceConfig(workspaceKey: string): WorkspaceModulesConfig {
  return {
    workspaceKey,
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

export async function getWorkspaceModules(
  workspaceKey = DEFAULT_WORKSPACE_KEY
): Promise<WorkspaceModulesConfig> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return defaultWorkspaceConfig(workspaceKey);
  }

  let result:
    | {
        rows?: Array<{
          workspace_key: string;
          modules: Partial<WorkspaceModuleFlags> | null;
          updated_at: Date | string | null;
        }>;
      }
    | undefined;

  try {
    result = await db.query<{
      workspace_key: string;
      modules: Partial<WorkspaceModuleFlags> | null;
      updated_at: Date | string | null;
    }>(
      `SELECT workspace_key, modules, updated_at
       FROM workspace_modules
       WHERE workspace_key = $1
       LIMIT 1`,
      [workspaceKey]
    );
  } catch {
    return defaultWorkspaceConfig(workspaceKey);
  }

  const row = result?.rows?.[0];
  if (!row) {
    return defaultWorkspaceConfig(workspaceKey);
  }

  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : typeof row.updated_at === "string"
        ? row.updated_at
        : null;

  return {
    workspaceKey: row.workspace_key,
    updatedAt,
    modules: normalizeWorkspaceModules(row.modules)
  };
}

export async function saveWorkspaceModules(
  modules: Partial<WorkspaceModuleFlags>,
  workspaceKey = DEFAULT_WORKSPACE_KEY
): Promise<WorkspaceModulesConfig> {
  const normalized = normalizeWorkspaceModules(modules);
  const result = await db.query<{
    workspace_key: string;
    modules: WorkspaceModuleFlags;
    updated_at: Date;
  }>(
    `INSERT INTO workspace_modules (workspace_key, modules, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (workspace_key)
     DO UPDATE SET modules = EXCLUDED.modules, updated_at = now()
     RETURNING workspace_key, modules, updated_at`,
    [workspaceKey, JSON.stringify(normalized)]
  );

  return {
    workspaceKey: result.rows[0].workspace_key,
    updatedAt: result.rows[0].updated_at.toISOString(),
    modules: normalizeWorkspaceModules(result.rows[0].modules)
  };
}

export async function isWorkspaceModuleEnabled(
  moduleKey: WorkspaceModuleKey,
  workspaceKey = DEFAULT_WORKSPACE_KEY
) {
  const config = await getWorkspaceModules(workspaceKey);
  return config.modules[moduleKey] === true;
}
