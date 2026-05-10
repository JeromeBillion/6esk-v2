import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getConnectionTokens: vi.fn(),
  updateConnectionTokens: vi.fn(),
  decryptToken: vi.fn(),
  encryptToken: vi.fn(),
  refreshGoogleToken: vi.fn(),
  refreshMicrosoftToken: vi.fn(),
  storeInboundEmail: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/oauth/connections", () => ({
  getConnectionTokens: mocks.getConnectionTokens,
  updateConnectionTokens: mocks.updateConnectionTokens
}));

vi.mock("@/server/oauth/crypto", () => ({
  decryptToken: mocks.decryptToken,
  encryptToken: mocks.encryptToken
}));

vi.mock("@/server/oauth/providers/google", () => ({
  refreshGoogleToken: mocks.refreshGoogleToken
}));

vi.mock("@/server/oauth/providers/microsoft", () => ({
  refreshMicrosoftToken: mocks.refreshMicrosoftToken
}));

vi.mock("@/server/email/inbound-store", () => ({
  storeInboundEmail: mocks.storeInboundEmail
}));

import { syncConnection } from "@/server/oauth/sync-engine";

const ACCESS_TOKEN_ENC = Buffer.from("combined-token-ciphertext-with-auth-tag");
const REFRESH_TOKEN_ENC = Buffer.alloc(0);
const TOKEN_IV = Buffer.from("1234567890abcdef");

function buildGoogleConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    tenant_id: "00000000-0000-0000-0000-000000000001",
    provider: "google",
    email_address: "inbox@example.com",
    token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    sync_cursor: null,
    ...overrides
  };
}

function mockGoogleFetchWithNoMessages(historyId = "history-123") {
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const value = String(url);
    if (value.includes("/messages?")) {
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    }
    if (value.includes("/profile")) {
      return new Response(JSON.stringify({ historyId }), { status: 200 });
    }
    return new Response("unexpected request", { status: 500 });
  }) as typeof fetch;
}

describe("oauth sync engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionTokens.mockResolvedValue({
      accessTokenEnc: ACCESS_TOKEN_ENC,
      refreshTokenEnc: REFRESH_TOKEN_ENC,
      tokenIv: TOKEN_IV
    });
    mocks.decryptToken.mockReturnValue(JSON.stringify({
      accessToken: "access-token",
      refreshToken: "refresh-token"
    }));
    mocks.encryptToken.mockReturnValue({
      ciphertext: Buffer.from("new-combined-token-ciphertext"),
      iv: Buffer.from("fedcba0987654321")
    });
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    mockGoogleFetchWithNoMessages();
  });

  it("decrypts the combined token payload stored in access_token_enc", async () => {
    await syncConnection(buildGoogleConnection());

    expect(mocks.decryptToken).toHaveBeenCalledWith(ACCESS_TOKEN_ENC, TOKEN_IV);
    expect(mocks.decryptToken).not.toHaveBeenCalledWith(REFRESH_TOKEN_ENC, TOKEN_IV);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE oauth_connections"),
      ["history-123", "11111111-1111-1111-1111-111111111111"]
    );
  });

  it("persists refreshed Google tokens using the same combined-token shape", async () => {
    mocks.refreshGoogleToken.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresIn: 3600
    });

    await syncConnection(buildGoogleConnection({
      token_expires_at: new Date(Date.now() - 60 * 1000).toISOString()
    }));

    expect(mocks.refreshGoogleToken).toHaveBeenCalledWith("refresh-token");
    expect(mocks.encryptToken).toHaveBeenCalledWith(JSON.stringify({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token"
    }));
    expect(mocks.updateConnectionTokens).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      Buffer.from("new-combined-token-ciphertext"),
      Buffer.alloc(0),
      Buffer.from("fedcba0987654321"),
      expect.any(Date)
    );
  });
});
