import { describe, expect, it } from "vitest";

import {
  BASE_PLATFORM_FEE_CENT,
  BYO_AI_MODULE_FEE_CENT,
  FIXED_USAGE_PRICES_CENT,
  MANAGED_AI_MODULE_FEE_CENT,
  MANAGED_EMAIL_PRICES_CENT,
  MODULE_PRICES,
  calculateMonthlyBaseFee,
  estimateUsageRevenueCent
} from "@/server/tenant/catalog";

describe("pricing catalog", () => {
  it("keeps the commercial model seatless with free aliases", () => {
    expect(BASE_PLATFORM_FEE_CENT).toBe(69900);
    expect(MANAGED_EMAIL_PRICES_CENT.alias).toBe(0);
  });

  it("prices AI as either managed or BYO inside the AI module", () => {
    expect(MANAGED_AI_MODULE_FEE_CENT).toBe(149900);
    expect(BYO_AI_MODULE_FEE_CENT).toBe(89900);

    expect(
      calculateMonthlyBaseFee({
        enabledModules: ["email", "vanillaWebchat", "aiAutomation"],
        byoMode: false,
        aiMode: "managed"
      })
    ).toBe(219800);

    expect(
      calculateMonthlyBaseFee({
        enabledModules: ["email", "vanillaWebchat", "aiAutomation"],
        byoMode: true,
        aiMode: "byo"
      })
    ).toBe(159800);
  });

  it("prices stacked modules without seat billing", () => {
    expect(MODULE_PRICES.whatsapp).toBe(49900);
    expect(MODULE_PRICES.voice).toBe(89900);

    expect(
      calculateMonthlyBaseFee({
        enabledModules: ["email", "vanillaWebchat", "whatsapp", "voice"],
        byoMode: false
      })
    ).toBe(209700);
  });

  it("bills only real completed usage events", () => {
    expect(
      estimateUsageRevenueCent({
        moduleKey: "email",
        usageKind: "direct_send",
        quantity: 1,
        eventCount: 1,
        costCent: 0
      })
    ).toBe(0);

    expect(
      estimateUsageRevenueCent({
        moduleKey: "email",
        usageKind: "outbound_email",
        quantity: 1,
        eventCount: 1,
        costCent: 2
      })
    ).toBe(FIXED_USAGE_PRICES_CENT.outboundEmail);
  });

  it("uses provider cost plus markup for provider pass-through channels", () => {
    expect(
      estimateUsageRevenueCent({
        moduleKey: "whatsapp",
        usageKind: "outbound_whatsapp",
        quantity: 1,
        eventCount: 1,
        costCent: 100
      })
    ).toBe(135);
  });

  it("charges AI by customer-visible outcome and passes through managed provider cost", () => {
    expect(
      estimateUsageRevenueCent({
        moduleKey: "aiAutomation",
        usageKind: "transcript_analysis",
        quantity: 5000,
        eventCount: 1,
        costCent: 42,
        providerMode: "managed"
      })
    ).toBe(142);

    expect(
      estimateUsageRevenueCent({
        moduleKey: "aiAutomation",
        usageKind: "transcript_analysis",
        quantity: 5000,
        eventCount: 1,
        costCent: 42,
        providerMode: "byo"
      })
    ).toBe(100);
  });
});
