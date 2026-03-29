import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listFailedWhatsAppOutboxEvents: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/whatsapp/outbox", () => ({
  listFailedWhatsAppOutboxEvents: mocks.listFailedWhatsAppOutboxEvents
}));

import { GET } from "@/app/api/admin/whatsapp/failed/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("GET /api/admin/whatsapp/failed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFailedWhatsAppOutboxEvents.mockResolvedValue([
      {
        id: "wa-evt-1",
        status: "failed",
        attempt_count: 5,
        last_error: "template rejected",
        payload: {
          to: "+27821234567"
        }
      }
    ]);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/whatsapp/failed"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("returns failed WhatsApp outbox events for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET(new Request("http://localhost/api/admin/whatsapp/failed?limit=25"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      id: "wa-evt-1",
      last_error: "template rejected",
      payload: {
        to: "+27821234567"
      }
    });
    expect(mocks.listFailedWhatsAppOutboxEvents).toHaveBeenCalledWith(25);
  });
});
