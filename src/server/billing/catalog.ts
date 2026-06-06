import type { WorkspaceModuleFlags, WorkspaceModuleKey } from "@/server/workspace-modules";
import type { WorkspaceModuleUsageSummary } from "@/server/module-metering";

export type BillingCatalogLine = {
  sku: string;
  label: string;
  moduleKey: WorkspaceModuleKey | "core_os";
  description: string;
  unitAmountCents: number;
  currency: "ZAR";
  billingPeriod: "month";
  included: boolean;
};

export type WorkspaceBillingQuoteLine = BillingCatalogLine & {
  enabled: boolean;
  quantity: number;
  subtotalCents: number;
};

export type WorkspaceBillingQuote = {
  catalogVersion: "v2.2026-06";
  currency: "ZAR";
  billingPeriod: "month";
  vatRatePercent: number;
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  lines: WorkspaceBillingQuoteLine[];
};

const CATALOG_VERSION = "v2.2026-06" as const;

export const BILLING_CATALOG: BillingCatalogLine[] = [
  {
    sku: "core_os",
    label: "Core OS",
    moduleKey: "core_os",
    description: "Base CRM workspace, shared inbox, ticketing, and email foundation.",
    unitAmountCents: 119_800,
    currency: "ZAR",
    billingPeriod: "month",
    included: false
  },
  {
    sku: "whatsapp",
    label: "WhatsApp",
    moduleKey: "whatsapp",
    description: "WhatsApp messaging, templates, delivery states, and resend flows.",
    unitAmountCents: 49_900,
    currency: "ZAR",
    billingPeriod: "month",
    included: false
  },
  {
    sku: "voice",
    label: "Voice",
    moduleKey: "voice",
    description: "Voice queueing, call operations, recordings, and transcript workflow.",
    unitAmountCents: 69_900,
    currency: "ZAR",
    billingPeriod: "month",
    included: false
  },
  {
    sku: "ai_automation",
    label: "AI Orchestration",
    moduleKey: "aiAutomation",
    description: "Dexter-owned AI actions, guardrails, replay, and automation runtime.",
    unitAmountCents: 149_900,
    currency: "ZAR",
    billingPeriod: "month",
    included: false
  },
  {
    sku: "vanilla_webchat",
    label: "Vanilla Webchat",
    moduleKey: "vanillaWebchat",
    description: "Human-operated webchat surface without autonomous AI behavior.",
    unitAmountCents: 0,
    currency: "ZAR",
    billingPeriod: "month",
    included: true
  }
];

function readVatRatePercent(value = process.env.BILLING_VAT_RATE_PERCENT) {
  const parsed = Number.parseFloat(value ?? "15");
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return 15;
  return parsed;
}

function isLineEnabled(line: BillingCatalogLine, modules: WorkspaceModuleFlags) {
  if (line.moduleKey === "core_os") return true;
  return modules[line.moduleKey] === true;
}

export function buildWorkspaceBillingQuote(
  modules: WorkspaceModuleFlags,
  input?: { vatRatePercent?: number }
): WorkspaceBillingQuote {
  const vatRatePercent = input?.vatRatePercent ?? readVatRatePercent();
  const lines = BILLING_CATALOG.map((line) => {
    const enabled = isLineEnabled(line, modules);
    const quantity = enabled ? 1 : 0;
    return {
      ...line,
      enabled,
      quantity,
      subtotalCents: enabled ? line.unitAmountCents * quantity : 0
    };
  });
  const subtotalCents = lines.reduce((total, line) => total + line.subtotalCents, 0);
  const vatCents = Math.round(subtotalCents * (vatRatePercent / 100));

  return {
    catalogVersion: CATALOG_VERSION,
    currency: "ZAR",
    billingPeriod: "month",
    vatRatePercent,
    subtotalCents,
    vatCents,
    totalCents: subtotalCents + vatCents,
    lines
  };
}

export function buildWorkspaceUsageExport(input: {
  workspaceKey: string;
  modules: WorkspaceModuleFlags;
  usage: WorkspaceModuleUsageSummary;
}) {
  const quote = buildWorkspaceBillingQuote(input.modules);
  return {
    formatVersion: "workspace-usage-export.v1" as const,
    generatedAt: new Date().toISOString(),
    workspaceKey: input.workspaceKey,
    windowDays: input.usage.windowDays,
    quote,
    usage: {
      daily: input.usage.daily,
      modules: input.usage.modules.map((moduleUsage) => ({
        moduleKey: moduleUsage.moduleKey,
        totalQuantity: moduleUsage.totalQuantity,
        eventCount: moduleUsage.eventCount,
        actorBreakdown: moduleUsage.actorBreakdown,
        usageKinds: moduleUsage.usageKinds
      }))
    }
  };
}

export function workspaceUsageExportToCsv(exportPayload: ReturnType<typeof buildWorkspaceUsageExport>) {
  const rows = [
    ["module", "usage_kind", "quantity", "event_count", "human", "ai", "system"],
    ...exportPayload.usage.modules.flatMap((moduleUsage) => {
      const usageKinds = moduleUsage.usageKinds.length
        ? moduleUsage.usageKinds
        : [{ usageKind: "none", quantity: 0, eventCount: 0 }];
      return usageKinds.map((kind) => [
        moduleUsage.moduleKey,
        kind.usageKind,
        String(kind.quantity),
        String(kind.eventCount),
        String(moduleUsage.actorBreakdown.human),
        String(moduleUsage.actorBreakdown.ai),
        String(moduleUsage.actorBreakdown.system)
      ]);
    })
  ];

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: string) {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
