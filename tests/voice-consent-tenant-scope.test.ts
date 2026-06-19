import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  getLatestVoiceConsentState,
  recordVoiceConsentEvent,
  resolveExistingCustomerIdForVoiceConsent
} from "@/server/calls/consent";

describe("voice consent tenant scope", () => {
  beforeEach(() => {
    mocks.dbQuery.mockReset();
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("requires tenant scope before resolving a consent customer", async () => {
    await expect(
      resolveExistingCustomerIdForVoiceConsent({
        tenantId: "",
        email: "customer@example.com"
      })
    ).rejects.toThrow("Resolve voice consent customer requires tenantId.");

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("resolves existing customers only inside the supplied tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: CUSTOMER_ID }], rowCount: 1 });

    await expect(
      resolveExistingCustomerIdForVoiceConsent({
        tenantId: TENANT_ID,
        email: "Customer@Example.com",
        phone: "+15551234567"
      })
    ).resolves.toBe(CUSTOMER_ID);

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND c.tenant_id = $3"),
      ["customer@example.com", "+15551234567", TENANT_ID]
    );
    expect(mocks.dbQuery.mock.calls[0]?.[0]).toContain("AND ci.tenant_id = c.tenant_id");
  });

  it("validates customer ownership before recording consent", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(
      recordVoiceConsentEvent({
        tenantId: TENANT_ID,
        decision: "granted",
        customerId: CUSTOMER_ID,
        phone: "+15551234567",
        source: "agent_portal"
      })
    ).rejects.toThrow("Voice consent customer must belong to the same tenant.");

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE id = $1"), [
      CUSTOMER_ID,
      TENANT_ID
    ]);
  });

  it("records consent with tenant_id once customer ownership is valid", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await recordVoiceConsentEvent({
      tenantId: TENANT_ID,
      decision: "revoked",
      customerId: CUSTOMER_ID,
      email: "customer@example.com",
      source: "help_center_self_service",
      metadata: { route: "test" }
    });

    const [insertSql, insertValues] = mocks.dbQuery.mock.calls[1] ?? [];
    expect(insertSql).toContain("INSERT INTO voice_consent_events");
    expect(insertSql).toContain("tenant_id");
    expect(insertValues[0]).toBe(TENANT_ID);
    expect(insertValues[1]).toBe(CUSTOMER_ID);
  });

  it("looks up latest consent only inside the supplied tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          customer_id: CUSTOMER_ID,
          identity_type: "phone",
          identity_value: "+15551234567",
          consent_state: "granted",
          callback_phone: "+15551234567",
          terms_version: "v1",
          source: "agent_portal",
          event_at: new Date("2026-02-19T10:00:00.000Z")
        }
      ],
      rowCount: 1
    });

    await expect(
      getLatestVoiceConsentState({
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        phone: "+15551234567"
      })
    ).resolves.toMatchObject({
      state: "granted",
      customerId: CUSTOMER_ID,
      identityType: "phone"
    });

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE tenant_id = $1");
    expect(sql).toContain("AND (");
    expect(values[0]).toBe(TENANT_ID);
    expect(values).toContain(CUSTOMER_ID);
    expect(values).toContain("+15551234567");
  });
});
