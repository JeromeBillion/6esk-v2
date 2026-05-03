import { type WorkspaceModuleKey } from "@/server/workspace-modules";

export type PlanFeatures = {
  maxUsers: number | "unlimited";
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

export const PLAN_CATALOG: Record<string, PlanTier> = {
  starter: {
    id: "starter",
    name: "Starter",
    monthlyPriceCent: 4900,
    currency: "USD",
    description: "Essential ticketing and webchat for small teams.",
    features: {
      maxUsers: 5,
      maxWorkspaces: 1,
      slaSupport: false,
      byoProviderMode: false,
      includedModules: ["email", "vanillaWebchat"]
    }
  },
  professional: {
    id: "professional",
    name: "Professional",
    monthlyPriceCent: 14900,
    currency: "USD",
    description: "Omnichannel support with essential AI automation.",
    features: {
      maxUsers: 25,
      maxWorkspaces: 3,
      slaSupport: true,
      byoProviderMode: true,
      includedModules: ["email", "whatsapp", "voice", "aiAutomation", "vanillaWebchat"]
    }
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    monthlyPriceCent: 49900,
    currency: "USD",
    description: "Full orchestration, advanced AI routing, and multi-tenant scaling.",
    features: {
      maxUsers: "unlimited",
      maxWorkspaces: 10,
      slaSupport: true,
      byoProviderMode: true,
      includedModules: [
        "email",
        "whatsapp",
        "voice",
        "aiAutomation",
        "dexterOrchestration",
        "vanillaWebchat"
      ]
    }
  }
};

export function getPlanTier(planId: string): PlanTier {
  return PLAN_CATALOG[planId] || PLAN_CATALOG["starter"];
}
