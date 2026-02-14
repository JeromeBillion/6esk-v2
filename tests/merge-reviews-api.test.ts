import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listMergeReviewTasksForUser: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/merge-reviews", () => ({
  listMergeReviewTasksForUser: mocks.listMergeReviewTasksForUser
}));

import { GET } from "@/app/api/merge-reviews/route";

function buildUser(roleName: "lead_admin" | "agent" | "viewer") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

describe("GET /api/merge-reviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMergeReviewTasksForUser.mockResolvedValue([]);
  });

  it("returns 401 when no session user exists", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost/api/merge-reviews"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.listMergeReviewTasksForUser).not.toHaveBeenCalled();
  });

  it("returns 403 for viewer role", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("viewer"));
    const response = await GET(new Request("http://localhost/api/merge-reviews"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.listMergeReviewTasksForUser).not.toHaveBeenCalled();
  });

  it("normalizes query params and defaults invalid status to pending", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.listMergeReviewTasksForUser.mockResolvedValue([{ id: "review-1" }]);

    const response = await GET(
      new Request(
        "http://localhost/api/merge-reviews?status=not_real&limit=999&q=duplicate&assigned=mine"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ reviews: [{ id: "review-1" }] });
    expect(mocks.listMergeReviewTasksForUser).toHaveBeenCalledWith(
      expect.objectContaining({ role_name: "agent" }),
      {
        status: "pending",
        search: "duplicate",
        limit: 200,
        assignedUserId: undefined
      }
    );
  });

  it("applies assigned=mine for lead admins", async () => {
    const admin = buildUser("lead_admin");
    mocks.getSessionUser.mockResolvedValue(admin);

    const response = await GET(
      new Request("http://localhost/api/merge-reviews?status=all&assigned=mine")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ reviews: [] });
    expect(mocks.listMergeReviewTasksForUser).toHaveBeenCalledWith(admin, {
      status: "all",
      search: null,
      limit: 50,
      assignedUserId: admin.id
    });
  });
});

