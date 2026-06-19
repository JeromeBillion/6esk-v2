import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VIEW_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TENANT_ID = "99999999-9999-4999-8999-999999999999";

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

import { GET, POST } from "@/app/api/support/saved-views/route";
import {
  PATCH as PATCH_VIEW,
  DELETE as DELETE_VIEW
} from "@/app/api/support/saved-views/[viewId]/route";

function buildUser() {
  return {
    id: USER_ID,
    email: "agent@6ex.co.za",
    display_name: "Agent",
    role_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    role_name: "agent",
    tenant_id: TENANT_ID
  };
}

describe("support saved views API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
  });

  it("GET returns 401 when unauthenticated", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
  });

  it("GET returns current user's saved views", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: VIEW_ID,
          name: "My Queue",
          filters: { status: "open", assigned: "mine" },
          created_at: "2026-03-19T08:00:00.000Z",
          updated_at: "2026-03-19T09:00:00.000Z"
        }
      ]
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.views).toEqual([
      {
        id: VIEW_ID,
        name: "My Queue",
        filters: { status: "open", assigned: "mine" },
        createdAt: "2026-03-19T08:00:00.000Z",
        updatedAt: "2026-03-19T09:00:00.000Z"
      }
    ]);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM support_saved_views"),
      [TENANT_ID, USER_ID]
    );
    expect(mocks.dbQuery.mock.calls[0]?.[0]).toContain("tenant_id = $1");
  });

  it("GET rejects tenantless sessions before saved-view reads", async () => {
    mocks.getSessionUser.mockResolvedValue({ ...buildUser(), tenant_id: null });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("POST creates a saved view", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: VIEW_ID,
          name: "Urgent Queue",
          filters: { priority: "urgent", assigned: "mine" },
          created_at: "2026-03-19T08:00:00.000Z",
          updated_at: "2026-03-19T08:00:00.000Z"
        }
      ]
    });

    const request = new Request("http://localhost/api/support/saved-views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Urgent Queue",
        filters: { priority: "urgent", assigned: "mine" }
      })
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.view).toMatchObject({
      id: VIEW_ID,
      name: "Urgent Queue"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO support_saved_views (tenant_id, user_id, name, filters)"),
      [TENANT_ID, USER_ID, "Urgent Queue", JSON.stringify({ priority: "urgent", assigned: "mine" })]
    );
  });

  it("PATCH updates a saved view", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: VIEW_ID,
          name: "Voice Queue",
          filters: { channel: "voice", assigned: "mine" },
          created_at: "2026-03-19T08:00:00.000Z",
          updated_at: "2026-03-19T10:00:00.000Z"
        }
      ]
    });

    const request = new Request(`http://localhost/api/support/saved-views/${VIEW_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Voice Queue",
        filters: { channel: "voice", assigned: "mine" }
      })
    });

    const response = await PATCH_VIEW(request, { params: Promise.resolve({ viewId: VIEW_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.view).toMatchObject({
      id: VIEW_ID,
      name: "Voice Queue"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND tenant_id = $5"),
      ["Voice Queue", JSON.stringify({ channel: "voice", assigned: "mine" }), VIEW_ID, USER_ID, TENANT_ID]
    );
  });

  it("DELETE removes a saved view", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rowCount: 1 });

    const response = await DELETE_VIEW(
      new Request(`http://localhost/api/support/saved-views/${VIEW_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ viewId: VIEW_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "deleted" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM support_saved_views"), [
      VIEW_ID,
      USER_ID,
      TENANT_ID
    ]);
  });
});
