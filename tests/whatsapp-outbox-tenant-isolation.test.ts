import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/agents/secret", () => ({
  decryptSecret: vi.fn()
}));

vi.mock("@/server/storage/r2", () => ({
  getObjectBuffer: vi.fn()
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: vi.fn()
}));

import {
  deliverPendingWhatsAppEvents,
  listFailedWhatsAppOutboxEvents,
  retryFailedWhatsAppEvents
} from "@/server/whatsapp/outbox";
import { getWhatsAppOutboxMetrics } from "@/server/whatsapp/outbox-metrics";

describe("WhatsApp outbox tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
  });

  it("scopes failed-event listing to the requested tenant", async () => {
    await listFailedWhatsAppOutboxEvents(25, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND tenant_id = $2"),
      [25, TENANT_ID]
    );
  });

  it("rejects failed-event listing without tenant scope", async () => {
    await expect(listFailedWhatsAppOutboxEvents(25, "")).rejects.toThrow(
      "List failed WhatsApp outbox events requires tenantId"
    );

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("scopes delivery locking to the requested tenant", async () => {
    await deliverPendingWhatsAppEvents({ limit: 10, tenantId: TENANT_ID });

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND e.tenant_id = $3"),
      [10, 300, TENANT_ID]
    );
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(3, "COMMIT");
  });

  it("rejects delivery without tenant scope", async () => {
    await expect(deliverPendingWhatsAppEvents({ limit: 10, tenantId: "" })).rejects.toThrow(
      "Deliver WhatsApp outbox events requires tenantId"
    );

    expect(mocks.dbConnect).not.toHaveBeenCalled();
  });

  it("scopes retry-by-id updates to the requested tenant", async () => {
    await retryFailedWhatsAppEvents({ eventIds: ["wa-event-1"], tenantId: TENANT_ID });

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND tenant_id = $2"),
      [["wa-event-1"], TENANT_ID]
    );
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(3, "COMMIT");
  });

  it("rejects retry without tenant scope", async () => {
    await expect(retryFailedWhatsAppEvents({ eventIds: ["wa-event-1"], tenantId: "" })).rejects.toThrow(
      "Retry failed WhatsApp outbox events requires tenantId"
    );

    expect(mocks.dbConnect).not.toHaveBeenCalled();
  });

  it("scopes metrics queries to the requested tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await getWhatsAppOutboxMetrics(TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND tenant_id = $1"),
      [TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND tenant_id = $1"),
      [TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("AND tenant_id = $1"),
      [TENANT_ID]
    );
  });

  it("marks global metrics as internal guard-suppressed", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await getWhatsAppOutboxMetrics(null);

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("tenant-query-guard: ignore internal-global-whatsapp-outbox-metrics"),
      []
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("tenant-query-guard: ignore internal-global-whatsapp-outbox-metrics"),
      []
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("tenant-query-guard: ignore internal-global-whatsapp-outbox-metrics"),
      []
    );
  });
});
