import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VIEW_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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
    role_name: "agent"
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
      [USER_ID]
    );
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
      USER_ID
    ]);
  });
});
