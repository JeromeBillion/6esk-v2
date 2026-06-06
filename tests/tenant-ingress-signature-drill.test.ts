import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  runTenantIngressSignatureDrill,
  shouldExpectStrictSignatures,
  writeDrillEvidence
} = require("../scripts/tenant-ingress-signature-drill.js") as {
  runTenantIngressSignatureDrill: (input?: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  }) => Promise<{
    strictExpected: boolean;
    freshStatus: number;
    replayStatus: number;
    replayRejected: boolean;
    evidence: Record<string, unknown>;
  }>;
  shouldExpectStrictSignatures: (env?: NodeJS.ProcessEnv) => boolean;
  writeDrillEvidence: (evidence: Record<string, unknown>, outputPath: string) => string | null;
};

const ORIGINAL_ENV = { ...process.env };
const TENANT_INGRESS_SECRET = "tenant-ingress-secret";

function strictEnv() {
  return {
    ...ORIGINAL_ENV,
    NODE_ENV: "test",
    APP_URL: "http://localhost",
    INBOUND_SHARED_SECRET: "inbound-secret",
    TENANT_INGRESS_REQUIRE_SCOPE: "true",
    TENANT_INGRESS_REQUIRE_SIGNATURE: "true",
    TENANT_INGRESS_TENANT: "tenant-a",
    TENANT_INGRESS_WORKSPACE: "workspace-a",
    TENANT_INGRESS_SIGNING_SECRETS_JSON: JSON.stringify({
      "tenant-a:workspace-a": TENANT_INGRESS_SECRET
    })
  };
}

function response(status: number, body: Record<string, unknown> = {}) {
  return new Response(JSON.stringify(body), { status });
}

describe("tenant ingress signature drill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("expects strict signatures in production by default", () => {
    expect(shouldExpectStrictSignatures({ ...ORIGINAL_ENV, NODE_ENV: "production" })).toBe(true);
    expect(
      shouldExpectStrictSignatures({
        ...ORIGINAL_ENV,
        NODE_ENV: "production",
        TENANT_INGRESS_DRILL_EXPECT_STRICT: "false"
      })
    ).toBe(false);
  });

  it("passes when the fresh request succeeds and replay is rejected", async () => {
    process.env = strictEnv();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, { status: "ok" }))
      .mockResolvedValueOnce(response(401, { code: "tenant_signature_invalid" }));

    const result = await runTenantIngressSignatureDrill({
      env: process.env,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date("2026-05-31T20:00:00.000Z")
    });

    expect(result).toMatchObject({
      strictExpected: true,
      freshStatus: 200,
      replayStatus: 401,
      replayRejected: true,
      evidence: {
        schemaVersion: 1,
        evidenceType: "tenant_ingress_signature_drill",
        generatedAt: "2026-05-31T20:00:00.000Z",
        status: "passed",
        secretsRedacted: true,
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        checks: {
          freshSignedRequest: {
            path: "/api/admin/inbound/metrics?hours=1",
            status: 200,
            ok: true
          },
          pathQueryReplay: {
            signedPath: "/api/admin/inbound/metrics?hours=1",
            replayPath: "/api/admin/inbound/metrics?hours=2",
            status: 401,
            rejected: true
          }
        }
      }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://localhost/api/admin/inbound/metrics?hours=1");
    expect(fetchImpl.mock.calls[1][0]).toBe("http://localhost/api/admin/inbound/metrics?hours=2");
  });

  it("fails under strict mode when path/query replay is accepted", async () => {
    process.env = strictEnv();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, { status: "ok" }))
      .mockResolvedValueOnce(response(200, { status: "ok" }));

    await expect(
      runTenantIngressSignatureDrill({
        env: process.env,
        fetchImpl: fetchImpl as unknown as typeof fetch
      })
    ).rejects.toThrow("Path/query replay expected 401");
  });

  it("fails fast when required drill env is missing", async () => {
    process.env = { ...ORIGINAL_ENV, APP_URL: "", INBOUND_SHARED_SECRET: "" };

    await expect(
      runTenantIngressSignatureDrill({
        env: process.env,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow("APP_URL and INBOUND_SHARED_SECRET are required");
  });

  it("writes redacted drill evidence to disk", () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-ingress-drill-"));
    const outputPath = path.join(outputDir, "evidence.json");
    const writtenPath = writeDrillEvidence(
      {
        schemaVersion: 1,
        evidenceType: "tenant_ingress_signature_drill",
        secretsRedacted: true
      },
      outputPath
    );

    expect(writtenPath).toBe(path.resolve(outputPath));
    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual({
      schemaVersion: 1,
      evidenceType: "tenant_ingress_signature_drill",
      secretsRedacted: true
    });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });
});
