import type { WorkspaceModuleUsageSummary } from "@/server/module-metering";
import type { BillingLifecycleSnapshot } from "@/server/billing/lifecycle";
import type { WorkspaceModuleFlags } from "@/server/workspace-modules";

export type WorkspaceUsageExport = ReturnType<typeof buildWorkspaceUsageExport>;

export function buildWorkspaceUsageExport(input: {
  workspaceKey: string;
  modules: WorkspaceModuleFlags;
  usage: WorkspaceModuleUsageSummary;
  billingLifecycle: BillingLifecycleSnapshot;
}) {
  return {
    formatVersion: "workspace-usage-export.v1" as const,
    generatedAt: new Date().toISOString(),
    workspaceKey: input.workspaceKey,
    windowDays: input.usage.windowDays,
    modules: input.modules,
    estimatedInvoice: {
      currency: input.billingLifecycle.account.currency,
      periodStart: input.billingLifecycle.estimatedInvoice.periodStart,
      periodEnd: input.billingLifecycle.estimatedInvoice.periodEnd,
      subtotalCent: input.billingLifecycle.estimatedInvoice.subtotalCent,
      usageCent: input.billingLifecycle.estimatedInvoice.usageCent,
      adjustmentCent: input.billingLifecycle.estimatedInvoice.adjustmentCent,
      taxCent: input.billingLifecycle.estimatedInvoice.taxCent,
      totalCent: input.billingLifecycle.estimatedInvoice.totalCent,
      amountDueCent: input.billingLifecycle.estimatedInvoice.amountDueCent,
      lines: input.billingLifecycle.estimatedInvoice.lines.map((line) => ({
        lineType: line.lineType,
        moduleKey: line.moduleKey,
        usageKind: line.usageKind,
        description: line.description,
        quantity: line.quantity,
        unitAmountCent: line.unitAmountCent,
        amountCent: line.amountCent,
        currency: line.currency
      }))
    },
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

export function workspaceUsageExportToCsv(exportPayload: WorkspaceUsageExport) {
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
