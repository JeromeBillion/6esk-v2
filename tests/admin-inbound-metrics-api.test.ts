import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getInboundMetrics: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/email/inbound-metrics", () => ({
  getInboundMetrics: mocks.getInboundMetrics
}));

import { GET } from "@/app/api/admin/inbound/metrics/route";

const ORIGINAL_ENV = { ...process.env };

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("GET /api/admin/inbound/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INBOUND_SHARED_SECRET = "inbound-secret";
    mocks.getInboundMetrics.mockResolvedValue({
      generatedAt: "2026-02-15T00:00:00.000Z",
      windowHours: 24,
      summary: {
        failedQueue: 2,
        dueRetryNow: 1,
        processingNow: 0,
        processedWindow: 10,
        failedWindow: 3,
        attemptsWindow: 15,
        retryProcessedWindow: 4,
        retryFailedWindow: 2,
        highAttemptQueue: 1,
        maxFailedAttemptCount: 6,
        p95FailedAttemptCount: 5.5,
        oldestFailedAgeMinutes: 120
      },
      alert: {
        source: "db",
        webhookConfigured: true,
        threshold: 5,
        windowMinutes: 30,
        cooldownMinutes: 60,
        currentFailures: 6,
        status: "at_or_above_threshold",
        cooldownRemainingMinutes: 0,
        lastSentAt: null,
        wouldSendNow: true,
        recommendation: {
          suggestedMinThreshold: 3,
          suggestedMaxThreshold: 6,
          inRange: true,
          reason: "aligned",
          avgBucketFailures: 2.3,
          p95BucketFailures: 5.2,
          maxBucketFailures: 8,
          bucketCount: 20
        }
      },
      failureReasons: [
        {
          code: "provider_timeout",
          label: "Provider Timeout",
          count: 2,
          sampleError: "timeout at upstream provider"
        }
      ],
      series: []
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 401 when caller is not admin and secret is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/inbound/metrics?hours=24"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.getInboundMetrics).not.toHaveBeenCalled();
  });

  it("returns metrics for lead admin callers", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET(new Request("http://localhost/api/admin/inbound/metrics?hours=48"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({
      failedQueue: 2,
      retryFailedWindow: 2,
      oldestFailedAgeMinutes: 120
    });
    expect(body.failureReasons).toHaveLength(1);
    expect(body.alert).toMatchObject({
      status: "at_or_above_threshold",
      threshold: 5
    });
    expect(mocks.getInboundMetrics).toHaveBeenCalledWith(48);
  });

  it("allows maintenance secret callers without session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/admin/inbound/metrics?hours=6", {
        headers: { "x-6esk-secret": "inbound-secret" }
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.getInboundMetrics).toHaveBeenCalledWith(6);
  });
});
