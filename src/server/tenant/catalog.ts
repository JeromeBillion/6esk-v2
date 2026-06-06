import { type WorkspaceModuleKey } from "@/server/workspace-modules";

export type ActionType = "email" | "whatsapp" | "voice" | "ai";
export type AiModuleBillingMode = "managed" | "byo";
export type ProviderMode = "managed" | "byo" | "none";

export const BASE_PLATFORM_FEE_CENT = 69900; // R699.00 (Core OS)
export const MANAGED_AI_MODULE_FEE_CENT = 149900; // R1,499.00
export const BYO_AI_MODULE_FEE_CENT = 89900; // R899.00
export const BYO_MODE_FEE_CENT = BYO_AI_MODULE_FEE_CENT; // Legacy export for BYO AI mode

export const MODULE_PRICES: Record<Exclude<WorkspaceModuleKey, "email" | "vanillaWebchat">, number> = {
  whatsapp: 49900, // R499.00
  voice: 89900, // R899.00
  aiAutomation: MANAGED_AI_MODULE_FEE_CENT, // Managed AI default
  dexterOrchestration: 0 // Included in AI Automation umbrella
};

export const ACTION_FEES_CENT: Record<ActionType, number> = {
  email: 5, // R0.05 outbound email; inbound is priced separately below.
  whatsapp: 0, // Provider cost plus markup only.
  voice: 0, // Provider cost plus markup only.
  ai: 100 // R1.00
};

export const MANAGED_EMAIL_PRICES_CENT = {
  domainRouting: 19900, // R199.00 / domain / month
  mailbox: 7900, // R79.00 / mailbox / month
  alias: 0 // Free aliases; do not create alias billing anxiety.
} as const;

export const FIXED_USAGE_PRICES_CENT = {
  inboundEmail: 3, // R0.03 per inbound email processed into CRM
  outboundEmail: 5, // R0.05 per successfully delivered outbound email
  sttTranscriptMinute: 35, // R0.35 per STT minute
  aiAction: 100, // R1.00 per customer-visible AI outcome/action
  storageGbMonth: 100 // R1.00 per GB-month
} as const;

export const PROVIDER_COST_MARKUP_BPS = 3500; // 35% markup on provider pass-through costs

const EMAIL_INBOUND_USAGE_KINDS = new Set([
  "ticket_created_inbound",
  "inbound_email",
  "inbound_email_processed"
]);

const EMAIL_OUTBOUND_USAGE_KINDS = new Set([
  "outbound_email",
  "email_delivered",
  "outbound_email_delivered"
]);

const PROVIDER_PASS_THROUGH_USAGE_KINDS = new Set([
  "outbound_whatsapp",
  "whatsapp_template_delivered",
  "outbound_call",
  "call_minute",
  "voice_minute"
]);

const STT_USAGE_KINDS = new Set([
  "stt_transcript_minute",
  "stt_transcript_minutes",
  "call_transcription_minute",
  "call_transcription_minutes"
]);

const STORAGE_USAGE_KINDS = new Set([
  "storage_gb_month",
  "storage_gb_months",
  "r2_storage_gb_month"
]);

const AI_ACTION_USAGE_KINDS = new Set([
  "draft_reply",
  "send_reply",
  "approved_draft_send",
  "transcript_analysis",
  "qa_review_completed",
  "resolution_note_generated",
  "action_items_extracted",
  "ticket_triage_classified",
  "merge_recommendation_created",
  "customer_profile_enriched",
  "call_qa_summary_generated",
  "approved_tool_action_executed",
  "initiate_call"
]);

const NON_BILLABLE_USAGE_KINDS = new Set([
  "direct_send",
  "reply_sent",
  "ticket_created_outbound",
  "bulk_email_created",
  "call_queued",
  "resend_queued",
  "agent_event_delivered",
  "draft_created",
  "draft_saved",
  "retry",
  "failed_send",
  "webhook_duplicate"
]);

export type TenantPlanSelection = {
  enabledModules: WorkspaceModuleKey[];
  byoMode: boolean;
  aiMode?: AiModuleBillingMode;
};

/**
 * Calculates the monthly base fee for a tenant based on their stacked Lego pieces.
 */
export function calculateMonthlyBaseFee(selection: TenantPlanSelection): number {
  let total = BASE_PLATFORM_FEE_CENT;

  for (const enabledModule of selection.enabledModules) {
    if (enabledModule === "email" || enabledModule === "vanillaWebchat") continue;
    if (enabledModule === "aiAutomation") {
      total += getAiModuleFee(selection.aiMode ?? (selection.byoMode ? "byo" : "managed"));
      continue;
    }
    total += MODULE_PRICES[enabledModule as keyof typeof MODULE_PRICES] || 0;
  }

  return total;
}

export function getAiModuleFee(mode: AiModuleBillingMode): number {
  return mode === "byo" ? BYO_AI_MODULE_FEE_CENT : MANAGED_AI_MODULE_FEE_CENT;
}

export function applyProviderCostMarkup(costCent: number) {
  if (!Number.isFinite(costCent) || costCent <= 0) return 0;
  return costCent * (1 + PROVIDER_COST_MARKUP_BPS / 10_000);
}

export function estimateUsageRevenueCent(input: {
  moduleKey: string;
  usageKind: string;
  quantity: number;
  eventCount: number;
  costCent: number;
  providerMode?: ProviderMode | string | null;
}) {
  const usageKind = input.usageKind.trim().toLowerCase();
  const moduleKey = input.moduleKey.trim();
  const quantity = Number.isFinite(input.quantity) && input.quantity > 0 ? input.quantity : 0;
  const eventCount = Number.isFinite(input.eventCount) && input.eventCount > 0 ? input.eventCount : 0;
  const costCent = Number.isFinite(input.costCent) && input.costCent > 0 ? input.costCent : 0;
  const providerMode = typeof input.providerMode === "string" ? input.providerMode.toLowerCase() : null;

  if (NON_BILLABLE_USAGE_KINDS.has(usageKind)) return 0;

  if (moduleKey === "email") {
    if (EMAIL_INBOUND_USAGE_KINDS.has(usageKind)) {
      return eventCount * FIXED_USAGE_PRICES_CENT.inboundEmail;
    }
    if (EMAIL_OUTBOUND_USAGE_KINDS.has(usageKind)) {
      return eventCount * FIXED_USAGE_PRICES_CENT.outboundEmail;
    }
  }

  if ((moduleKey === "whatsapp" || moduleKey === "voice") && PROVIDER_PASS_THROUGH_USAGE_KINDS.has(usageKind)) {
    return applyProviderCostMarkup(costCent);
  }

  if (STT_USAGE_KINDS.has(usageKind)) {
    return quantity * FIXED_USAGE_PRICES_CENT.sttTranscriptMinute;
  }

  if (STORAGE_USAGE_KINDS.has(usageKind)) {
    return quantity * FIXED_USAGE_PRICES_CENT.storageGbMonth;
  }

  if (moduleKey === "aiAutomation" && AI_ACTION_USAGE_KINDS.has(usageKind)) {
    const actionFee = eventCount * FIXED_USAGE_PRICES_CENT.aiAction;
    const managedProviderCost = providerMode === "managed" ? costCent : 0;
    return actionFee + managedProviderCost;
  }

  return 0;
}

/**
 * Legacy compatibility layer. 
 * Since we moved to modular pricing, we define a "Standard" virtual tier.
 */
export type PlanFeatures = {
  maxWorkspaces: number;
  slaSupport: boolean;
  byoProviderMode: boolean;
  includedModules: WorkspaceModuleKey[];
};

export type PlanTier = {
  id: string;
  name: string;
  monthlyPriceCent: number;
  currency: string;
  description: string;
  features: PlanFeatures;
};

// We keep a default 'standard' tier for legacy UI components that expect a single plan ID
export const PLAN_CATALOG: Record<string, PlanTier> = {
  standard: {
    id: "standard",
    name: "Standard",
    monthlyPriceCent: BASE_PLATFORM_FEE_CENT,
    currency: "ZAR",
    description: "Modular Customer OS. Pay only for the pieces you stack.",
    features: {
      maxWorkspaces: 10,
      slaSupport: true,
      byoProviderMode: true,
      includedModules: ["email", "vanillaWebchat"]
    }
  }
};

export function getPlanTier(planId: string): PlanTier {
  return PLAN_CATALOG[planId] || PLAN_CATALOG["standard"];
}
