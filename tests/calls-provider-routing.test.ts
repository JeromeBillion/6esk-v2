import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  createOrUpdateInboundCall,
  isInboundCallProviderRoutingError,
  resolveInboundCallProviderScope
} from "@/server/calls/service";

const ORIGINAL_ENV = { ...process.env };

describe("inbound call provider tenant routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("resolves a provider-owned voice number to one tenant scope", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ tenant_key: "tenant-a", workspace_key: "workspace-a" }]
    });

    const scope = await resolveInboundCallProviderScope({
      provider: "twilio",
      toPhone: "+27 11 000 0000",
      metadata: { accountSid: "AC123" }
    });

    expect(scope).toEqual({ tenantKey: "tenant-a", workspaceKey: "workspace-a" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM call_provider_numbers"),
      ["twilio", "+27110000000", "AC123"]
    );
  });

  it("rejects ambiguous provider-owned voice routes", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        { tenant_key: "tenant-a", workspace_key: "workspace-a" },
        { tenant_key: "tenant-b", workspace_key: "workspace-b" }
      ]
    });

    try {
      await resolveInboundCallProviderScope({
        provider: "twilio",
        toPhone: "+27 11 000 0000",
        metadata: { accountSid: "AC123" }
      });
      throw new Error("Expected route resolution to fail.");
    } catch (error) {
      expect(isInboundCallProviderRoutingError(error)).toBe(true);
      expect(error).toMatchObject({
        code: "ambiguous_call_provider_route",
        status: 409
      });
    }
  });

  it("fails closed before writes when strict inbound calls have no provider route", async () => {
    process.env.TENANT_INGRESS_REQUIRE_SCOPE = "true";
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    try {
      await createOrUpdateInboundCall({
        provider: "twilio",
        providerCallId: "CA123",
        fromPhone: "+27 72 000 0001",
        toPhone: "+27 11 000 0000",
        metadata: { accountSid: "AC123" }
      });
      throw new Error("Expected inbound call creation to fail.");
    } catch (error) {
      expect(isInboundCallProviderRoutingError(error)).toBe(true);
      expect(error).toMatchObject({
        code: "unresolved_call_provider_route",
        status: 404
      });
    }

    expect(mocks.dbQuery).toHaveBeenCalledTimes(2);
    expect(mocks.dbQuery.mock.calls[1][0]).toContain("FROM call_provider_numbers");
  });
});
