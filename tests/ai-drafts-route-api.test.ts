import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listPendingDraftsForUser: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/agents/drafts", () => ({
  listPendingDraftsForUser: mocks.listPendingDraftsForUser
}));

import { GET } from "@/app/api/ai-drafts/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("GET /api/ai-drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPendingDraftsForUser.mockResolvedValue([]);
  });

  it("returns 401 when no session user exists", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/ai-drafts"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.listPendingDraftsForUser).not.toHaveBeenCalled();
  });

  it("passes voice channel through filters and applies assigned=mine for lead admins", async () => {
    const admin = buildUser("lead_admin");
    mocks.getSessionUser.mockResolvedValue(admin);

    const response = await GET(
      new Request("http://localhost/api/ai-drafts?q=%20call%20&channel=voice&assigned=mine")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ drafts: [] });
    expect(mocks.listPendingDraftsForUser).toHaveBeenCalledWith(admin, {
      search: "call",
      channel: "voice",
      assignedUserId: admin.id
    });
  });

  it("normalizes all channel to null and ignores assigned=mine for non-admin", async () => {
    const agent = buildUser("agent");
    mocks.getSessionUser.mockResolvedValue(agent);

    const response = await GET(
      new Request("http://localhost/api/ai-drafts?q=%20%20&channel=all&assigned=mine")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ drafts: [] });
    expect(mocks.listPendingDraftsForUser).toHaveBeenCalledWith(agent, {
      search: null,
      channel: null,
      assignedUserId: undefined
    });
  });
});
