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
    preflightCustomerMerge: vi.fn(),
    MergeError
  };
});

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/merges", () => ({
  preflightCustomerMerge: mocks.preflightCustomerMerge,
  MergeError: mocks.MergeError
}));

import { POST } from "@/app/api/customers/merge/preflight/route";

const SOURCE_CUSTOMER_ID = "33333333-3333-3333-3333-333333333333";
const TARGET_CUSTOMER_ID = "44444444-4444-4444-4444-444444444444";

function buildUser(roleName: "agent" | "viewer") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName
  };
}

function buildPreflight(blockingCode: "already_merged" | null, blockingReason: string | null) {
  return {
    sourceCustomerId: SOURCE_CUSTOMER_ID,
    targetCustomerId: TARGET_CUSTOMER_ID,
    sourceCustomer: {
      kind: "unregistered",
      displayName: "Source",
      primaryEmail: "source@example.com",
      primaryPhone: "+27710000001",
      mergedIntoCustomerId: blockingCode === "already_merged" ? TARGET_CUSTOMER_ID : null
    },
    targetCustomer: {
      kind: "registered",
      displayName: "Target",
      primaryEmail: "target@example.com",
      primaryPhone: "+27710000002",
      mergedIntoCustomerId: null
    },
    moveCounts: {
      totalTickets: 10,
      activeTickets: 4,
      activeEmailTickets: 2,
      activeWhatsappTickets: 2,
      sourceIdentities: 3,
      identitiesToMove: 2,
      identityConflicts: 1
    },
    allowed: blockingCode === null,
    blockingCode,
    blockingReason
  };
}

async function postPreflight(payload: Record<string, unknown>) {
  const request = new Request("http://localhost/api/customers/merge/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const response = await POST(request);
  const body = await response.json();
  return { response, body };
}

describe("POST /api/customers/merge/preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.preflightCustomerMerge.mockResolvedValue(buildPreflight(null, null));
  });

  it("returns preflight payload with already_merged blocking details", async () => {
    mocks.preflightCustomerMerge.mockResolvedValue(
      buildPreflight("already_merged", "Source or target customer is already merged.")
    );

    const { response, body } = await postPreflight({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID
    });

    expect(response.status).toBe(200);
    expect(body.preflight).toMatchObject({
      allowed: false,
      blockingCode: "already_merged",
      blockingReason: "Source or target customer is already merged."
    });
  });

  it("returns 401 when session is missing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const { response, body } = await postPreflight({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID
    });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.preflightCustomerMerge).not.toHaveBeenCalled();
  });

  it("returns 403 for viewer role", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("viewer"));

    const { response, body } = await postPreflight({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID
    });

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.preflightCustomerMerge).not.toHaveBeenCalled();
  });

  it("maps invalid_input merge error to HTTP 400", async () => {
    mocks.preflightCustomerMerge.mockRejectedValue(
      new mocks.MergeError("invalid_input", "Source and target customers must be different.")
    );

    const { response, body } = await postPreflight({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "invalid_input",
      error: "Source and target customers must be different."
    });
  });

  it("returns allowed preflight payload when merge is permitted", async () => {
    const { response, body } = await postPreflight({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: TARGET_CUSTOMER_ID
    });

    expect(response.status).toBe(200);
    expect(body.preflight).toMatchObject({
      allowed: true,
      blockingCode: null,
      blockingReason: null
    });
  });

  it("returns 400 when source and target customer IDs are identical", async () => {
    const { response, body } = await postPreflight({
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      targetCustomerId: SOURCE_CUSTOMER_ID
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "invalid_input",
      error: "Source and target customers must be different."
    });
    expect(mocks.preflightCustomerMerge).not.toHaveBeenCalled();
  });
});
