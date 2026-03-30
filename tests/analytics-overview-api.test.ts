import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  getDateRange: vi.fn(),
  getTodayRangeUtc: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/analytics/dateRange", () => ({
  getDateRange: mocks.getDateRange,
  getTodayRangeUtc: mocks.getTodayRangeUtc
}));

import { GET } from "@/app/api/analytics/overview/route";

const START = new Date("2026-02-01T00:00:00.000Z");
const END = new Date("2026-02-08T00:00:00.000Z");
const TODAY_START = new Date("2026-02-07T00:00:00.000Z");
const TODAY_END = new Date("2026-02-08T00:00:00.000Z");

function buildUser() {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "admin@6ex.co.za",
    display_name: "Admin",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "lead_admin"
  };
}

describe("GET /api/analytics/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.getDateRange.mockReturnValue({ start: START, end: END });
    mocks.getTodayRangeUtc.mockReturnValue({ start: TODAY_START, end: TODAY_END });
  });

  it("returns 401 when no session user exists", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/analytics/overview"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("includes voice channel analytics in overview response", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ count: 11 }] }) // total tickets
      .mockResolvedValueOnce({ rows: [{ count: 4 }] }) // open tickets
      .mockResolvedValueOnce({ rows: [{ count: 3 }] }) // created today
      .mockResolvedValueOnce({ rows: [{ count: 2 }] }) // solved today
      .mockResolvedValueOnce({ rows: [{ avg_seconds: 120 }] }) // first response
      .mockResolvedValueOnce({ rows: [{ avg_seconds: 600 }] }) // resolution
      .mockResolvedValueOnce({
        rows: [
          {
            email_inbound: 5,
            email_outbound: 3,
            whatsapp_inbound: 2,
            whatsapp_outbound: 4,
            voice_inbound: 6,
            voice_outbound: 5,
            whatsapp_sent: 4,
            whatsapp_delivered: 3,
            whatsapp_read: 2,
            whatsapp_failed: 1
          }
        ]
      }) // channel summary
      .mockResolvedValueOnce({
        rows: [
          {
            completed: 3,
            failed: 1,
            no_answer: 1,
            busy: 0,
            canceled: 0,
            avg_duration_seconds: 86
          }
        ]
      }) // voice summary
      .mockResolvedValueOnce({
        rows: [
          {
            analyzed: 4,
            pass: 2,
            watch: 1,
            review: 1,
            flagged: 2,
            total_flags: 3,
            total_action_items: 2
          }
        ]
      }) // voice QA summary
      .mockResolvedValueOnce({
        rows: [{ total: 1, ai_initiated: 1, human_initiated: 0 }]
      }) // ticket merge summary
      .mockResolvedValueOnce({
        rows: [{ total: 0, ai_initiated: 0, human_initiated: 0 }]
      }) // customer merge summary
      .mockResolvedValueOnce({
        rows: [{ pending: 2, rejected_in_range: 1, failed_in_range: 1 }]
      }) // merge review summary
      .mockResolvedValueOnce({
        rows: [{ reason: "sample_failure", count: 1 }]
      }); // merge failure reasons

    const response = await GET(
      new Request("http://localhost/api/analytics/overview?start=2026-02-01&end=2026-02-08")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.channels.email).toMatchObject({ inbound: 5, outbound: 3 });
    expect(body.channels.whatsapp).toMatchObject({
      inbound: 2,
      outbound: 4,
      failed: 1
    });
    expect(body.channels.voice).toMatchObject({
      inbound: 6,
      outbound: 5,
      completed: 3,
      failed: 1,
      noAnswer: 1,
      busy: 0,
      canceled: 0,
      avgDurationSeconds: 86
    });
    expect(body.voiceQa).toMatchObject({
      analyzed: 4,
      pass: 2,
      watch: 1,
      review: 1,
      flagged: 2,
      totalFlags: 3,
      totalActionItems: 2
    });
  });
});
