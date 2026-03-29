import { db } from "@/server/db";
import {
  DEFAULT_WORKSPACE_KEY,
  type WorkspaceModuleKey
} from "@/server/workspace-modules";

export type ModuleUsageActorType = "human" | "ai" | "system";
export type ModuleUsageProviderMode = "managed" | "byo" | "none";

export type RecordModuleUsageArgs = {
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
  "venusOrchestration",
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

export async function recordModuleUsageEvent({
  workspaceKey = DEFAULT_WORKSPACE_KEY,
  moduleKey,
  usageKind,
  quantity = 1,
  unit = "event",
  actorType,
  providerMode = null,
  metadata = null
}: RecordModuleUsageArgs) {
  await db.query(
    `INSERT INTO workspace_module_usage_events (
       workspace_key,
       module_key,
       usage_kind,
       quantity,
       unit,
       actor_type,
       provider_mode,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
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
}

export async function getWorkspaceModuleUsageSummary(input?: {
  workspaceKey?: string;
  windowDays?: number;
}): Promise<WorkspaceModuleUsageSummary> {
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
     WHERE workspace_key = $1
       AND created_at >= now() - ($2::text || ' days')::interval
     GROUP BY module_key, usage_kind, actor_type
     ORDER BY module_key, usage_kind, actor_type`,
    [workspaceKey, String(windowDays)]
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

  return {
    workspaceKey,
    windowDays,
    generatedAt: new Date().toISOString(),
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
