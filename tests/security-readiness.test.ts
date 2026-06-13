import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { getSecurityReadinessSnapshot } from "@/server/security/readiness";

describe("getSecurityReadinessSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "session-secret-123456";
    process.env.INBOUND_SHARED_SECRET = "inbound-secret";
    process.env.AGENT_SECRET_KEY = "agent-secret-long-enough";
    process.env.CRON_SECRET = "cron-secret";
    process.env.WHATSAPP_APP_SECRET = "whatsapp-secret";
    process.env.CALLS_WEBHOOK_SECRET = "calls-webhook-secret";
    process.env.CALLS_OUTBOX_SECRET = "calls-outbox-secret";
    process.env.OAUTH_ENCRYPTION_KEY = "a".repeat(64);
    process.env.WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS = "false";
    process.env.CALLS_WEBHOOK_ALLOW_UNAUTHENTICATED = "false";
    process.env.CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE = "false";
  });

  it("reports healthy when required controls pass and failed queues are zero", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const snapshot = await getSecurityReadinessSnapshot();

    expect(snapshot.healthy).toBe(true);
    expect(snapshot.operations.activePrivilegedAccessGrants).toBe(0);
    expect(snapshot.operations.privilegedAccessGrantsNeedingReview).toBe(0);
    expect(snapshot.operations.failedOutbox.total).toBe(0);
    expect(snapshot.checks.every((check) => check.ok)).toBe(true);
    expect(mocks.dbQuery.mock.calls.every(([query]) => String(query).includes("tenant-query-guard: ignore"))).toBe(
      true
    );
  });
});
