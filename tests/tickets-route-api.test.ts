import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listTicketsForUser: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/tickets", () => ({
  listTicketsForUser: mocks.listTicketsForUser
}));

import { GET } from "@/app/api/tickets/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("GET /api/tickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTicketsForUser.mockResolvedValue([]);
  });

  it("returns 401 when no session user exists", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/tickets"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.listTicketsForUser).not.toHaveBeenCalled();
  });

  it("passes voice channel through filters and applies assigned=mine for lead admins", async () => {
    const admin = buildUser("lead_admin");
    mocks.getSessionUser.mockResolvedValue(admin);

    const response = await GET(
      new Request(
        "http://localhost/api/tickets?status=open&priority=high&tag=kyc&q=%20voice%20&channel=voice&assigned=mine"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ tickets: [] });
    expect(mocks.listTicketsForUser).toHaveBeenCalledWith(admin, {
      status: "open",
      priority: "high",
      tag: "kyc",
      search: "voice",
      assignedUserId: admin.id,
      channel: "voice"
    });
  });

  it("normalizes all channel/status/priority/tag to null and ignores assigned=mine for non-admin", async () => {
    const agent = buildUser("agent");
    mocks.getSessionUser.mockResolvedValue(agent);

    const response = await GET(
      new Request(
        "http://localhost/api/tickets?status=all&priority=all&tag=all&q=%20%20&channel=all&assigned=mine"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ tickets: [] });
    expect(mocks.listTicketsForUser).toHaveBeenCalledWith(agent, {
      status: null,
      priority: null,
      tag: null,
      search: null,
      assignedUserId: undefined,
      channel: null
    });
  });
});
