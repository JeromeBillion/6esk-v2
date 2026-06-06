import { db } from "@/server/db";
import {
  DEFAULT_WORKSPACE_KEY,
  isWorkspaceModuleEnabled,
  type WorkspaceModuleKey
} from "@/server/workspace-modules";
import { DEFAULT_TENANT_KEY } from "@/server/tenant-context";

export type ModuleUsageActorType = "human" | "ai" | "system";
export type ModuleUsageProviderMode = "managed" | "byo" | "none";

export type RecordModuleUsageArgs = {
  tenantKey?: string;
  workspaceKey?: string;
  moduleKey: WorkspaceModuleKey;
  usageKind: string;
  quantity?: number;
  unit?: string;
  actorType: ModuleUsageActorType;
  providerMode?: ModuleUsageProviderMode | null;
  metadata?: Record<string, unknown> | null;
};

export type WorkspaceModuleUsageSummary = {
  workspaceKey: string;
  windowDays: number;
  generatedAt: string;
  daily: Array<{
    date: string;
    totalQuantity: number;
    eventCount: number;
    modules: Record<WorkspaceModuleKey, number>;
  }>;
  modules: Array<{
    moduleKey: WorkspaceModuleKey;
    totalQuantity: number;
    eventCount: number;
    actorBreakdown: Record<ModuleUsageActorType, number>;
    lastSeenAt: string | null;
    usageKinds: Array<{
      usageKind: string;
      quantity: number;
      eventCount: number;
    }>;
  }>;
};

const MODULE_KEYS: WorkspaceModuleKey[] = [
  "email",
  "whatsapp",
  "voice",
  "aiAutomation",
  "vanillaWebchat"
];

function normalizeQuantity(value: number | undefined) {
  if (!Number.isFinite(value)) return 1;
  const normalized = Math.trunc(value ?? 1);
  return normalized > 0 ? normalized : 1;
}

function clampWindowDays(value: number | undefined) {
  if (!Number.isFinite(value)) return 30;
  return Math.min(90, Math.max(1, Math.trunc(value ?? 30)));
}

function readBooleanEnv(name: string) {
  const normalized = process.env[name]?.trim().toLowerCase();
  if (!normalized) return false;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function meteringFailClosed() {
  return (
    process.env.NODE_ENV === "production" ||
    readBooleanEnv("ENTITLEMENTS_FAIL_CLOSED") ||
    readBooleanEnv("MODULE_METERING_FAIL_CLOSED")
  );
}

export async function recordModuleUsageEvent({
  tenantKey = DEFAULT_TENANT_KEY,
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  moduleKey,
  usageKind,
  quantity = 1,
  unit = "event",
  actorType,
  providerMode = null,
  metadata = null
}: RecordModuleUsageArgs) {
  const failClosed = meteringFailClosed();
  if ((process.env.NODE_ENV === "test" || process.env.VITEST === "true") && !failClosed) {
    return;
  }

  try {
    const enabled = await isWorkspaceModuleEnabled(moduleKey, workspaceKey, tenantKey);
    if (!enabled) {
      throw new Error(`Module ${moduleKey} is not enabled for this tenant workspace.`);
    }

    await db.query(
      `INSERT INTO workspace_module_usage_events (
         tenant_key,
         workspace_key,
         module_key,
         usage_kind,
         quantity,
         unit,
         actor_type,
         provider_mode,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        tenantKey,
        workspaceKey,
        moduleKey,
        usageKind,
        normalizeQuantity(quantity),
        unit,
        actorType,
        providerMode,
        JSON.stringify(metadata ?? {})
      ]
    );
  } catch (error) {
    if (failClosed) {
      throw error;
    }
    // Best-effort telemetry outside fail-closed billing posture.
  }
}

export async function getWorkspaceModuleUsageSummary(input?: {
  tenantKey?: string;
  workspaceKey?: string;
  windowDays?: number;
}): Promise<WorkspaceModuleUsageSummary> {
  const tenantKey = input?.tenantKey ?? DEFAULT_TENANT_KEY;
  const workspaceKey = input?.workspaceKey ?? DEFAULT_WORKSPACE_KEY;
  const windowDays = clampWindowDays(input?.windowDays);

  const result = await db.query<{
    module_key: WorkspaceModuleKey;
    usage_kind: string;
    actor_type: ModuleUsageActorType;
    total_quantity: string | number;
    event_count: string | number;
    last_seen_at: string | null;
  }>(
    `SELECT
       module_key,
       usage_kind,
       actor_type,
       SUM(quantity)::bigint AS total_quantity,
       COUNT(*)::bigint AS event_count,
       MAX(created_at)::text AS last_seen_at
     FROM workspace_module_usage_events
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND created_at >= now() - ($3::text || ' days')::interval
     GROUP BY module_key, usage_kind, actor_type
     ORDER BY module_key, usage_kind, actor_type`,
    [tenantKey, workspaceKey, String(windowDays)]
  );

  const dailyResult = await db.query<{
    bucket_date: string;
    module_key: WorkspaceModuleKey;
    total_quantity: string | number;
    event_count: string | number;
  }>(
    `SELECT
       to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS bucket_date,
       module_key,
       SUM(quantity)::bigint AS total_quantity,
       COUNT(*)::bigint AS event_count
     FROM workspace_module_usage_events
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND created_at >= now() - ($3::text || ' days')::interval
     GROUP BY bucket_date, module_key
     ORDER BY bucket_date ASC, module_key ASC`,
    [tenantKey, workspaceKey, String(windowDays)]
  );

  const modulesMap = new Map<
    WorkspaceModuleKey,
    WorkspaceModuleUsageSummary["modules"][number]
  >();

  for (const moduleKey of MODULE_KEYS) {
    modulesMap.set(moduleKey, {
      moduleKey,
      totalQuantity: 0,
      eventCount: 0,
      actorBreakdown: {
        human: 0,
        ai: 0,
        system: 0
      },
      lastSeenAt: null,
      usageKinds: []
    });
  }

  const kindsMap = new Map<string, { quantity: number; eventCount: number }>();
  const dailyMap = new Map<
    string,
    {
      date: string;
      totalQuantity: number;
      eventCount: number;
      modules: Record<WorkspaceModuleKey, number>;
    }
  >();

  for (const row of result.rows) {
    const moduleSummary = modulesMap.get(row.module_key);
    if (!moduleSummary) continue;

    const quantity = Number(row.total_quantity ?? 0);
    const eventCount = Number(row.event_count ?? 0);
    moduleSummary.totalQuantity += quantity;
    moduleSummary.eventCount += eventCount;
    moduleSummary.actorBreakdown[row.actor_type] += quantity;

    if (!moduleSummary.lastSeenAt || (row.last_seen_at && row.last_seen_at > moduleSummary.lastSeenAt)) {
      moduleSummary.lastSeenAt = row.last_seen_at;
    }

    const kindKey = `${row.module_key}:${row.usage_kind}`;
    const existingKind = kindsMap.get(kindKey) ?? { quantity: 0, eventCount: 0 };
    existingKind.quantity += quantity;
    existingKind.eventCount += eventCount;
    kindsMap.set(kindKey, existingKind);
  }

  for (const [key, aggregate] of kindsMap.entries()) {
    const [moduleKey, usageKind] = key.split(":", 2) as [WorkspaceModuleKey, string];
    const moduleSummary = modulesMap.get(moduleKey);
    if (!moduleSummary) continue;
    moduleSummary.usageKinds.push({
      usageKind,
      quantity: aggregate.quantity,
      eventCount: aggregate.eventCount
    });
  }

  for (const row of dailyResult.rows) {
    const moduleKey = row.module_key;
    if (!MODULE_KEYS.includes(moduleKey)) continue;
    const existing =
      dailyMap.get(row.bucket_date) ??
      {
        date: row.bucket_date,
        totalQuantity: 0,
        eventCount: 0,
        modules: {
          email: 0,
          whatsapp: 0,
          voice: 0,
          aiAutomation: 0,
          vanillaWebchat: 0
        }
      };
    const quantity = Number(row.total_quantity ?? 0);
    const eventCount = Number(row.event_count ?? 0);
    existing.modules[moduleKey] += quantity;
    existing.totalQuantity += quantity;
    existing.eventCount += eventCount;
    dailyMap.set(row.bucket_date, existing);
  }

  return {
    workspaceKey,
    windowDays,
    generatedAt: new Date().toISOString(),
    daily: Array.from(dailyMap.values()),
    modules: MODULE_KEYS.map((key) => {
      const summary = modulesMap.get(key)!;
      summary.usageKinds.sort((left, right) => right.quantity - left.quantity);
      return summary;
    })
  };
}

export function resolveAiProviderMode(
  metadata?: Record<string, unknown> | null
): ModuleUsageProviderMode {
  const explicit =
    typeof metadata?.providerMode === "string"
      ? metadata.providerMode.trim().toLowerCase()
      : typeof metadata?.provider_mode === "string"
        ? metadata.provider_mode.trim().toLowerCase()
        : "";

  if (explicit === "byo") return "byo";
  if (explicit === "none") return "none";
  return "managed";
}
