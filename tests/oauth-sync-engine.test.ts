import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getConnectionTokens: vi.fn(),
  updateConnectionTokens: vi.fn(),
  decryptToken: vi.fn(),
  encryptToken: vi.fn(),
  refreshGoogleToken: vi.fn(),
  refreshMicrosoftToken: vi.fn(),
  storeInboundEmail: vi.fn(),
  findMailboxForOAuthConnection: vi.fn()
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

vi.mock("@/server/email/mailbox", () => ({
  findMailboxForOAuthConnection: mocks.findMailboxForOAuthConnection
}));

import { syncConnection } from "@/server/oauth/sync-engine";

const ACCESS_TOKEN_ENC = Buffer.from("combined-token-ciphertext-with-auth-tag");
const REFRESH_TOKEN_ENC = Buffer.alloc(0);
const TOKEN_IV = Buffer.from("1234567890abcdef");
const MAILBOX = {
  id: "mailbox-1",
  tenant_id: "00000000-0000-0000-0000-000000000001",
  type: "platform",
  address: "inbox@example.com",
  owner_user_id: null
};

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
    mocks.findMailboxForOAuthConnection.mockResolvedValue(MAILBOX);
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
    expect(mocks.findMailboxForOAuthConnection).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "00000000-0000-0000-0000-000000000001"
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

  it("stores provider mail through the connected mailbox instead of resolving message headers globally", async () => {
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes("/messages?")) {
        return new Response(JSON.stringify({ messages: [{ id: "gmail-1", threadId: "thread-1" }] }), { status: 200 });
      }
      if (value.includes("/messages/gmail-1?")) {
        return new Response(
          JSON.stringify({
            id: "gmail-1",
            snippet: "Forwarded support request",
            payload: {
              headers: [
                { name: "From", value: "customer@example.net" },
                { name: "To", value: "alias-owned-by-other-tenant@example.com" },
                { name: "Subject", value: "Need help" },
                { name: "Message-ID", value: "<gmail-1@example.net>" }
              ]
            }
          }),
          { status: 200 }
        );
      }
      if (value.includes("/messages/gmail-1/modify")) {
        return new Response("OK", { status: 200 });
      }
      if (value.includes("/profile")) {
        return new Response(JSON.stringify({ historyId: "history-456" }), { status: 200 });
      }
      return new Response("unexpected request", { status: 500 });
    }) as typeof fetch;

    await syncConnection(buildGoogleConnection());

    expect(mocks.storeInboundEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alias-owned-by-other-tenant@example.com",
        messageId: "<gmail-1@example.net>"
      }),
      { mailbox: MAILBOX }
    );
  });

  it("fails closed when an OAuth connection is not attached to a tenant mailbox", async () => {
    mocks.findMailboxForOAuthConnection.mockResolvedValueOnce(null);

    await expect(syncConnection(buildGoogleConnection())).rejects.toThrow(
      "OAuth connection is not attached to a tenant mailbox."
    );

    expect(mocks.getConnectionTokens).not.toHaveBeenCalled();
    expect(mocks.storeInboundEmail).not.toHaveBeenCalled();
  });
});
