import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkGooglePubSubPushHeaders: vi.fn(),
  checkGooglePubSubSubscription: vi.fn(),
  dbQuery: vi.fn(),
  syncConnection: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      error: vi.fn()
    }))
  }
}));

vi.mock("@6esk/auth/google-pubsub", () => ({
  checkGooglePubSubPushHeaders: mocks.checkGooglePubSubPushHeaders,
  checkGooglePubSubSubscription: mocks.checkGooglePubSubSubscription
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/oauth/sync-engine", () => ({
  syncConnection: mocks.syncConnection
}));

vi.mock("@/server/logger", () => ({
  requestLogger: () => mocks.logger
}));

import { POST } from "@/app/api/oauth/webhooks/google/route";

function webhookRequest(body: Record<string, unknown>) {
  return new NextRequest("https://app.example.com/api/oauth/webhooks/google", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function pubSubBody(overrides: Record<string, unknown> = {}) {
  const data = Buffer.from(
    JSON.stringify({
      emailAddress: "customer@example.com",
      historyId: "123"
    })
  ).toString("base64");

  return {
    subscription: "projects/project-id/subscriptions/gmail-events",
    message: { data },
    ...overrides
  };
}

describe("Google OAuth webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkGooglePubSubPushHeaders.mockResolvedValue({
      ok: true,
      tokenEmail: "pubsub-push@project.iam.gserviceaccount.com",
      tokenSubject: "service-account-subject"
    });
    mocks.checkGooglePubSubSubscription.mockReturnValue({
      ok: true,
      tokenEmail: null,
      tokenSubject: null
    });
    mocks.syncConnection.mockResolvedValue(undefined);
  });

  it("rejects unauthenticated Pub/Sub pushes before touching mailbox state", async () => {
    mocks.checkGooglePubSubPushHeaders.mockResolvedValueOnce({
      ok: false,
      status: 403,
      reason: "Google Pub/Sub push Authorization bearer token is required."
    });

    const response = await POST(webhookRequest(pubSubBody()));

    expect(response.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
    expect(mocks.syncConnection).not.toHaveBeenCalled();
  });

  it("rejects unexpected Pub/Sub subscriptions before touching mailbox state", async () => {
    mocks.checkGooglePubSubSubscription.mockReturnValueOnce({
      ok: false,
      status: 403,
      reason: "Google Pub/Sub subscription does not match the configured webhook subscription."
    });

    const response = await POST(webhookRequest(pubSubBody({ subscription: "projects/other/subscriptions/gmail-events" })));

    expect(response.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
    expect(mocks.syncConnection).not.toHaveBeenCalled();
  });

  it("syncs the active Google mailbox after Pub/Sub push checks pass", async () => {
    const connection = {
      id: "conn-1",
      tenant_id: "tenant-1",
      provider: "google",
      email_address: "customer@example.com",
      token_expires_at: null,
      sync_cursor: "cursor-1"
    };
    mocks.dbQuery.mockResolvedValueOnce({ rows: [connection] });

    const response = await POST(webhookRequest(pubSubBody()));

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("FROM oauth_connections"), [
      "customer@example.com"
    ]);
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("JOIN mailboxes m");
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("m.oauth_connection_id = c.id");
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("m.tenant_id = c.tenant_id");
    expect(mocks.syncConnection).toHaveBeenCalledWith(connection);
  });

  it("does not pick an arbitrary tenant when active mailbox connections are ambiguous", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "conn-1",
          tenant_id: "tenant-1",
          provider: "google",
          email_address: "customer@example.com",
          token_expires_at: null,
          sync_cursor: "cursor-1"
        },
        {
          id: "conn-2",
          tenant_id: "tenant-2",
          provider: "google",
          email_address: "customer@example.com",
          token_expires_at: null,
          sync_cursor: "cursor-2"
        }
      ]
    });

    const response = await POST(webhookRequest(pubSubBody()));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Ambiguous connection");
    expect(mocks.syncConnection).not.toHaveBeenCalled();
  });
});
