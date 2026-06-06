import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { GET } from "@/app/api/whatsapp/templates/route";

function buildUser() {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "agent@example.test",
    display_name: "Agent",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "agent",
    tenant_key: "tenant-wa",
    workspace_key: "workspace-wa"
  };
}

describe("GET /api/whatsapp/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires an authenticated user", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("lists active templates only inside the user's workspace", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_key = $1"),
      ["tenant-wa", "workspace-wa"]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND workspace_key = $2"),
      ["tenant-wa", "workspace-wa"]
    );
  });
});
