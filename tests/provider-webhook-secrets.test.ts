import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { listActiveProviderWebhookSecrets } from "@/server/provider-webhook-secrets";

const ORIGINAL_ENV = { ...process.env };

describe("provider webhook secret lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockResolvedValue({ rows: [] });
    process.env = {
      ...ORIGINAL_ENV,
      TENANT_PROVIDER_WEBHOOK_SECRETS_JSON: JSON.stringify({
        "tenant-a:workspace-a:whatsapp:app_secret": "generic-secret",
        "tenant-a:workspace-a:whatsapp:app_secret:waba-1": "account-secret",
        "tenant-a:workspace-a:whatsapp:app_secret:waba-2": "other-account-secret"
      })
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("does not use account-specific env secrets when no account id is available", async () => {
    const secrets = await listActiveProviderWebhookSecrets({
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      provider: "whatsapp",
      secretType: "app_secret"
    });

    expect(secrets).toEqual([{ id: "env:0", secret: "generic-secret", source: "env" }]);
  });

  it("uses exact account-specific env secrets plus generic fallback when account id is available", async () => {
    const secrets = await listActiveProviderWebhookSecrets({
      scope: { tenantKey: "tenant-a", workspaceKey: "workspace-a" },
      provider: "whatsapp",
      secretType: "app_secret",
      providerAccountId: "waba-1"
    });

    expect(secrets).toEqual([
      { id: "env:0", secret: "generic-secret", source: "env" },
      { id: "env:1", secret: "account-secret", source: "env" }
    ]);
  });
});
