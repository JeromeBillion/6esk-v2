import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MergeError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  return {
    getSessionUser: vi.fn(),
    mergeCustomers: vi.fn(),
    MergeError
  };
});

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/merges", () => ({
  mergeCustomers: mocks.mergeCustomers,
  MergeError: mocks.MergeError
}));

import { POST } from "@/app/api/customers/merge/route";

const SOURCE_CUSTOMER_ID = "33333333-3333-3333-3333-333333333333";
const TARGET_CUSTOMER_ID = "44444444-4444-4444-4444-444444444444";
const ACK_TEXT = "I understand this merge is irreversible";

function buildUser(roleName: "agent" | "viewer") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

async function postMerge(payload: Record<string, unknown>) {
  const request = new Request("http://localhost/api/customers/merge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await POST(request);
  const body = await response.json();
  return { response, body };
}

describe("POST /api/customers/merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.mergeCustomers.mockResolvedValue({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID,
      movedTickets: 2,
      movedIdentities: 2
    });
  });

  it("returns 409 with already_merged code when source or target is already merged", async () => {
    mocks.mergeCustomers.mockRejectedValue(
      new mocks.MergeError("already_merged", "Source or target customer is already merged.")
    );

    const { response, body } = await postMerge({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID,
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "already_merged",
      error: "Source or target customer is already merged."
    });
    expect(mocks.mergeCustomers).toHaveBeenCalledWith({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID,
      actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      reason: null
    });
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const { response, body } = await postMerge({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID,
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.mergeCustomers).not.toHaveBeenCalled();
  });

  it("returns 403 for viewer role", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("viewer"));
    const { response, body } = await postMerge({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID,
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.mergeCustomers).not.toHaveBeenCalled();
  });

  it("maps invalid_input to HTTP 400", async () => {
    mocks.mergeCustomers.mockRejectedValue(
      new mocks.MergeError("invalid_input", "Source and target customers must be different.")
    );

    const { response, body } = await postMerge({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID,
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "invalid_input",
      error: "Source and target customers must be different."
    });
  });

  it("returns success payload when mergeCustomers resolves", async () => {
    const { response, body } = await postMerge({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID,
      reason: "Duplicate profiles",
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "merged",
      result: {
        sourceCustomerId: SOURCE_CUSTOMER_ID,
        targetCustomerId: TARGET_CUSTOMER_ID,
        movedTickets: 2,
        movedIdentities: 2
      }
    });
  });

  it("returns 400 when irreversible acknowledgement is missing or invalid", async () => {
    const { response, body } = await postMerge({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID,
      acknowledgement: "not accepted"
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid payload" });
    expect(mocks.mergeCustomers).not.toHaveBeenCalled();
  });

  it("returns 400 when source and target customer IDs are identical", async () => {
    const { response, body } = await postMerge({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: SOURCE_CUSTOMER_ID,
      acknowledgement: ACK_TEXT
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "invalid_input",
      error: "Source and target customers must be different."
    });
    expect(mocks.mergeCustomers).not.toHaveBeenCalled();
  });
});
