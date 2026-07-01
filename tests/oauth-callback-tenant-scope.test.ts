import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  createOAuthConnection: vi.fn(),
  encryptToken: vi.fn(),
  exchangeGoogleCode: vi.fn(),
  fetchGoogleUserProfile: vi.fn(),
  exchangeMicrosoftCode: vi.fn(),
  fetchMicrosoftUserProfile: vi.fn(),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: vi.fn()
  }
}));

vi.mock("@/server/oauth/connections", () => ({
  createOAuthConnection: mocks.createOAuthConnection
}));

vi.mock("@/server/oauth/crypto", () => ({
  encryptToken: mocks.encryptToken
}));

vi.mock("@/server/oauth/providers/google", () => ({
  exchangeGoogleCode: mocks.exchangeGoogleCode,
  fetchGoogleUserProfile: mocks.fetchGoogleUserProfile
}));

vi.mock("@/server/oauth/providers/microsoft", () => ({
  exchangeMicrosoftCode: mocks.exchangeMicrosoftCode,
  fetchMicrosoftUserProfile: mocks.fetchMicrosoftUserProfile
}));

vi.mock("@/server/logger", () => ({
  requestLogger: () => mocks.logger
}));

import { GET } from "@/app/api/oauth/callback/route";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function callbackRequest(state: Record<string, string>) {
  const stateRaw = Buffer.from(JSON.stringify(state)).toString("base64url");
  return new NextRequest(`https://app.example.com/api/oauth/callback?code=auth-code&state=${stateRaw}`, {
    headers: {
      cookie: "oauth_nonce=nonce-1"
    }
  });
}

describe("OAuth callback tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: USER_ID,
      tenant_id: TENANT_ID
    });
    mocks.exchangeGoogleCode.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600
    });
    mocks.fetchGoogleUserProfile.mockResolvedValue({
      email: "support@example.com",
      id: "google-subject"
    });
    mocks.encryptToken.mockReturnValue({
      ciphertext: Buffer.from("ciphertext"),
      iv: Buffer.from("1234567890abcdef")
    });
  });

  it("rejects a provider mailbox claimed by another tenant before creating OAuth tokens", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: OTHER_TENANT_ID }]
    });

    const response = await GET(
      callbackRequest({
        nonce: "nonce-1",
        provider: "google",
        type: "platform",
        tenantId: TENANT_ID,
        userId: USER_ID
      })
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toBe("Mailbox address belongs to another tenant");
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      "SELECT tenant_id FROM mailboxes WHERE lower(address) = lower($1) LIMIT 1",
      ["support@example.com"]
    );
    expect(mocks.createOAuthConnection).not.toHaveBeenCalled();
  });
});
