import { type WorkspaceModuleKey } from "@/server/workspace-modules";

export type ActionType = "email" | "whatsapp" | "voice" | "ai";

export const BASE_PLATFORM_FEE_CENT = 49900; // R499.00 (Core OS)
export const BYO_MODE_FEE_CENT = 49900; // R499.00

export const MODULE_PRICES: Record<Exclude<WorkspaceModuleKey, "email" | "vanillaWebchat">, number> = {
  whatsapp: 49900, // R499.00
  voice: 69900, // R699.00
  aiAutomation: 149900, // R1,499.00 (Combined AI umbrella)
  dexterOrchestration: 0 // Included in AI Automation umbrella
};

export const ACTION_FEES_CENT: Record<ActionType, number> = {
  email: 20, // R0.20
  whatsapp: 99, // R0.99
  voice: 250, // R2.50
  ai: 100 // R1.00
};

export type TenantPlanSelection = {
  enabledModules: WorkspaceModuleKey[];
  byoMode: boolean;
};

/**
 * Calculates the monthly base fee for a tenant based on their stacked Lego pieces.
 */
export function calculateMonthlyBaseFee(selection: TenantPlanSelection): number {
  let total = BASE_PLATFORM_FEE_CENT;

  if (selection.byoMode) {
    total += BYO_MODE_FEE_CENT;
  }

  for (const module of selection.enabledModules) {
    if (module === "email" || module === "vanillaWebchat") continue;
    total += MODULE_PRICES[module as keyof typeof MODULE_PRICES] || 0;
  }

  return total;
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
