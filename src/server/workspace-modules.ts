import { db } from "@/server/db";
import { DEFAULT_TENANT_KEY } from "@/server/tenant-context";

export const DEFAULT_WORKSPACE_KEY = "primary";

export type WorkspaceModuleFlags = {
  email: boolean;
  whatsapp: boolean;
  voice: boolean;
  aiAutomation: boolean;
  vanillaWebchat: boolean;
};

export type WorkspaceModuleKey = keyof WorkspaceModuleFlags;

export type WorkspaceModuleStatus = "active" | "disabled" | "suspended" | "downgrade_pending";

export type WorkspaceModuleEntitlement = {
  enabled: boolean;
  status: WorkspaceModuleStatus;
  planKey: string | null;
  billingMode: "billable" | "included" | "trial" | "none" | null;
  reason: string | null;
  effectiveAt: string | null;
};

export type WorkspaceModuleEntitlements = Record<WorkspaceModuleKey, WorkspaceModuleEntitlement>;

export type WorkspaceModulesConfig = {
  tenantKey: string;
  workspaceKey: string;
  updatedAt: string | null;
  modules: WorkspaceModuleFlags;
  entitlements: WorkspaceModuleEntitlements;
  source: "database" | "default" | "fail_closed";
  failureReason?: "database_error" | "missing_configuration" | null;
};

export const DEFAULT_WORKSPACE_MODULES: WorkspaceModuleFlags = {
  email: true,
  whatsapp: true,
  voice: true,
  aiAutomation: true,
  vanillaWebchat: true
};

const MODULE_KEYS: WorkspaceModuleKey[] = [
  "email",
  "whatsapp",
  "voice",
  "aiAutomation",
  "vanillaWebchat"
];

const FAIL_CLOSED_WORKSPACE_MODULES: WorkspaceModuleFlags = {
  email: false,
  whatsapp: false,
  voice: false,
  aiAutomation: false,
  vanillaWebchat: false
};

function defaultWorkspaceConfig(
  workspaceKey: string,
  tenantKey = DEFAULT_TENANT_KEY,
  modules = DEFAULT_WORKSPACE_MODULES
): WorkspaceModulesConfig {
  const normalized = normalizeWorkspaceModules(modules);
  return {
    tenantKey,
    workspaceKey,
    updatedAt: null,
    modules: normalized,
    entitlements: normalizeWorkspaceModuleEntitlements(modules),
    source: modules === FAIL_CLOSED_WORKSPACE_MODULES ? "fail_closed" : "default",
    failureReason: modules === FAIL_CLOSED_WORKSPACE_MODULES ? "missing_configuration" : null
  };
}

function coerceBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readBooleanEnv(name: string) {
  const normalized = process.env[name]?.trim().toLowerCase();
  if (!normalized) return false;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function entitlementsFailClosed() {
  return process.env.NODE_ENV === "production" || readBooleanEnv("ENTITLEMENTS_FAIL_CLOSED");
}

function normalizeStatus(value: unknown, enabled: boolean): WorkspaceModuleStatus {
  if (typeof value !== "string") return enabled ? "active" : "disabled";
  const normalized = value.trim().toLowerCase();
  if (normalized === "active") return "active";
  if (normalized === "suspended") return "suspended";
  if (normalized === "downgrade_pending") return "downgrade_pending";
  if (normalized === "disabled") return "disabled";
  return enabled ? "active" : "disabled";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBillingMode(value: unknown): WorkspaceModuleEntitlement["billingMode"] {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === "billable" || normalized === "included" || normalized === "trial" || normalized === "none") {
    return normalized;
  }
  return null;
}

function normalizeModuleEntitlement(value: unknown, fallback: boolean): WorkspaceModuleEntitlement {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const enabled = coerceBoolean(value, fallback);
    return {
      enabled,
      status: enabled ? "active" : "disabled",
      planKey: null,
      billingMode: null,
      reason: null,
      effectiveAt: null
    };
  }

  const record = value as Record<string, unknown>;
  const enabled = coerceBoolean(record.enabled, fallback);
  const status = normalizeStatus(record.status, enabled);
  const active = enabled && status !== "disabled" && status !== "suspended";

  return {
    enabled: active,
    status,
    planKey: readString(record.planKey ?? record.plan_key),
    billingMode: readBillingMode(record.billingMode ?? record.billing_mode),
    reason: readString(record.reason),
    effectiveAt: readString(record.effectiveAt ?? record.effective_at)
  };
}

export function normalizeWorkspaceModuleEntitlements(
  input?: Partial<Record<WorkspaceModuleKey, unknown>> | null
): WorkspaceModuleEntitlements {
  return MODULE_KEYS.reduce((entitlements, moduleKey) => {
    entitlements[moduleKey] = normalizeModuleEntitlement(
      input?.[moduleKey],
      DEFAULT_WORKSPACE_MODULES[moduleKey]
    );
    return entitlements;
  }, {} as WorkspaceModuleEntitlements);
}

export function normalizeWorkspaceModules(
  input?: Partial<Record<WorkspaceModuleKey, unknown>> | null
): WorkspaceModuleFlags {
  const entitlements = normalizeWorkspaceModuleEntitlements(input);
  return {
    email: entitlements.email.enabled,
    whatsapp: entitlements.whatsapp.enabled,
    voice: entitlements.voice.enabled,
    aiAutomation: entitlements.aiAutomation.enabled,
    vanillaWebchat: entitlements.vanillaWebchat.enabled
  };
}

export async function getWorkspaceModules(
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  tenantKey = DEFAULT_TENANT_KEY
): Promise<WorkspaceModulesConfig> {
  const failClosed = entitlementsFailClosed();
  if ((process.env.NODE_ENV === "test" || process.env.VITEST === "true") && !failClosed) {
    return defaultWorkspaceConfig(workspaceKey, tenantKey);
  }

  let result:
    | {
        rows?: Array<{
          tenant_key: string;
          workspace_key: string;
          modules: Partial<Record<WorkspaceModuleKey, unknown>> | null;
          updated_at: Date | string | null;
        }>;
      }
    | undefined;

  try {
    result = await db.query<{
      tenant_key: string;
      workspace_key: string;
      modules: Partial<Record<WorkspaceModuleKey, unknown>> | null;
      updated_at: Date | string | null;
    }>(
      `SELECT tenant_key, workspace_key, modules, updated_at
       FROM workspace_modules
       WHERE tenant_key = $1
         AND workspace_key = $2
       LIMIT 1`,
      [tenantKey, workspaceKey]
    );
  } catch {
    if (failClosed) {
      return {
        ...defaultWorkspaceConfig(workspaceKey, tenantKey, FAIL_CLOSED_WORKSPACE_MODULES),
        failureReason: "database_error"
      };
    }
    return defaultWorkspaceConfig(workspaceKey, tenantKey);
  }

  const row = result?.rows?.[0];
  if (!row) {
    if (failClosed) {
      return defaultWorkspaceConfig(workspaceKey, tenantKey, FAIL_CLOSED_WORKSPACE_MODULES);
    }
    return defaultWorkspaceConfig(workspaceKey, tenantKey);
  }

  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : typeof row.updated_at === "string"
        ? row.updated_at
        : null;

  const entitlements = normalizeWorkspaceModuleEntitlements(row.modules);
  return {
    tenantKey: row.tenant_key,
    workspaceKey: row.workspace_key,
    updatedAt,
    modules: normalizeWorkspaceModules(row.modules),
    entitlements,
    source: "database",
    failureReason: null
  };
}

export async function saveWorkspaceModules(
  modules: Partial<WorkspaceModuleFlags>,
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  tenantKey = DEFAULT_TENANT_KEY
): Promise<WorkspaceModulesConfig> {
  const normalized = normalizeWorkspaceModules(modules);
  const result = await db.query<{
    tenant_key: string;
    workspace_key: string;
    modules: WorkspaceModuleFlags;
    updated_at: Date;
  }>(
    `INSERT INTO workspace_modules (tenant_key, workspace_key, modules, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (tenant_key, workspace_key)
     DO UPDATE SET modules = EXCLUDED.modules, updated_at = now()
     RETURNING tenant_key, workspace_key, modules, updated_at`,
    [tenantKey, workspaceKey, JSON.stringify(normalized)]
  );

  return {
    tenantKey: result.rows[0].tenant_key,
    workspaceKey: result.rows[0].workspace_key,
    updatedAt: result.rows[0].updated_at.toISOString(),
    modules: normalizeWorkspaceModules(result.rows[0].modules),
    entitlements: normalizeWorkspaceModuleEntitlements(result.rows[0].modules),
    source: "database",
    failureReason: null
  };
}

export async function isWorkspaceModuleEnabled(
  moduleKey: WorkspaceModuleKey,
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  tenantKey = DEFAULT_TENANT_KEY
) {
  const config = await getWorkspaceModules(workspaceKey, tenantKey);
  return config.modules[moduleKey] === true;
}
