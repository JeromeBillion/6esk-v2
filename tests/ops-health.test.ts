import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEmailOutboxMetrics: vi.fn(),
  getWhatsAppOutboxMetrics: vi.fn(),
  getCallOutboxMetrics: vi.fn(),
  getDexterRuntimeStatus: vi.fn()
}));

vi.mock("@/server/email/outbox", () => ({
  getEmailOutboxMetrics: mocks.getEmailOutboxMetrics
}));

vi.mock("@/server/whatsapp/outbox-metrics", () => ({
  getWhatsAppOutboxMetrics: mocks.getWhatsAppOutboxMetrics
}));

vi.mock("@/server/calls/outbox", () => ({
  getCallOutboxMetrics: mocks.getCallOutboxMetrics
}));

vi.mock("@/server/dexter-runtime", () => ({
  getDexterRuntimeStatus: mocks.getDexterRuntimeStatus
}));

import { getOpsHealthSnapshot } from "@/server/ops/health";

describe("getOpsHealthSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEmailOutboxMetrics.mockResolvedValue({ queue: { failed: 0 } });
    mocks.getWhatsAppOutboxMetrics.mockResolvedValue({ queue: { failed: 0 } });
    mocks.getCallOutboxMetrics.mockResolvedValue({ queue: { failed: 0 } });
    mocks.getDexterRuntimeStatus.mockReturnValue({ state: "active" });
  });

  it("marks readiness true when runtime is healthy and queues have no failed events", async () => {
    const snapshot = await getOpsHealthSnapshot({ tenantId: "tenant-1" });
    expect(snapshot.ready).toBe(true);
    expect(snapshot.tenantId).toBe("tenant-1");
  });

  it("marks readiness false when runtime is failed", async () => {
    mocks.getDexterRuntimeStatus.mockReturnValue({ state: "failed" });
    const snapshot = await getOpsHealthSnapshot({ tenantId: "tenant-1" });
    expect(snapshot.ready).toBe(false);
  });
});
