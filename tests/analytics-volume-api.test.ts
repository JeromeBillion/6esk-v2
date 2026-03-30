import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  getDateRange: vi.fn(),
  parseWhatsAppStatusSource: vi.fn(),
  buildWhatsAppStatusSeries: vi.fn()
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
  getDateRange: mocks.getDateRange
}));

vi.mock("@/server/analytics/whatsapp-series", () => ({
  parseWhatsAppStatusSource: mocks.parseWhatsAppStatusSource,
  buildWhatsAppStatusSeries: mocks.buildWhatsAppStatusSeries
}));

import { GET } from "@/app/api/analytics/volume/route";

const START = new Date("2026-02-01T00:00:00.000Z");
const END = new Date("2026-02-08T00:00:00.000Z");

function buildUser() {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "admin@6ex.co.za",
    display_name: "Admin",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "lead_admin"
  };
}

describe("GET /api/analytics/volume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.getDateRange.mockReturnValue({ start: START, end: END });
    mocks.parseWhatsAppStatusSource.mockReturnValue("all");
    mocks.buildWhatsAppStatusSeries.mockReturnValue({
      sent: [],
      delivered: [],
      read: [],
      failed: []
    });
  });

  it("returns 401 when no session user exists", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/analytics/volume"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
  });

  it("includes voice daily outcomes in response payload", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [{ day: new Date("2026-02-02T00:00:00.000Z"), count: 5 }]
      })
      .mockResolvedValueOnce({
        rows: [{ day: new Date("2026-02-02T00:00:00.000Z"), count: 3 }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: [
          {
            day: new Date("2026-02-02T00:00:00.000Z"),
            inbound: 2,
            outbound: 4,
            completed: 3,
            failed: 1,
            no_answer: 0,
            busy: 0,
            canceled: 0,
            avg_duration_seconds: 95
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            day: new Date("2026-02-02T00:00:00.000Z"),
            analyzed: 2,
            pass: 1,
            watch: 1,
            review: 0,
            flagged: 1,
            total_flags: 2
          }
        ]
      });

    const response = await GET(new Request("http://localhost/api/analytics/volume"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.voice).toMatchObject([
      {
        day: "2026-02-02T00:00:00.000Z",
        inbound: 2,
        outbound: 4,
        completed: 3,
        failed: 1,
        avgDurationSeconds: 95
      }
    ]);
    expect(body.voiceQa).toMatchObject([
      {
        day: "2026-02-02T00:00:00.000Z",
        analyzed: 2,
        pass: 1,
        watch: 1,
        review: 0,
        flagged: 1,
        totalFlags: 2
      }
    ]);
  });
});
