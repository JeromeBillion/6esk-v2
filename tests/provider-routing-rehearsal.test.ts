import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  buildRehearsalDefinitions,
  parseArgs,
  runProviderRoutingRehearsal,
  shouldExpectStrictProviderSecrets,
  writeRehearsalEvidence
} from "../scripts/provider-routing-rehearsal.js";

describe("provider routing rehearsal", () => {
  it("parses scoped evidence options", () => {
    expect(
      parseArgs([
        "--tenant=tenant-a",
        "--workspace=workspace-a",
        "--sample-limit=3",
        "--include-passed",
        "--evidence-dir=.launch-evidence/provider-routing",
        "--json"
      ])
    ).toMatchObject({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      sampleLimit: 3,
      includePassed: true,
      evidenceDir: ".launch-evidence/provider-routing",
      json: true
    });
  });

  it("rejects partial tenant scope", () => {
    expect(() => parseArgs(["--tenant=tenant-a"])).toThrow(/--tenant and --workspace/);
  });

  it("builds scoped checks for every launch provider route family", () => {
    const definitions = buildRehearsalDefinitions(
      { tenantKey: "tenant-a", workspaceKey: "workspace-a", sampleLimit: 2 },
      { NODE_ENV: "production" }
    );
    const keys = definitions.map((definition) => definition.key);

    expect(keys).toContain("resend.mailbox_address_ambiguous");
    expect(keys).toContain("resend.webhook_secret_missing");
    expect(keys).toContain("whatsapp.waba_ambiguous");
    expect(keys).toContain("whatsapp.app_secret_missing");
    expect(keys).toContain("twilio.phone_ambiguous");
    expect(keys).toContain("twilio.auth_token_missing");
    expect(keys).toContain("managed_stt.http_secret_missing");
    expect(keys).toContain("deepgram.callback_token_missing");
    expect(keys).toContain("public_origin.origin_ambiguous");
    expect(keys).toContain("public_origin.active_origin_missing");
  });

  it("treats production or explicit strict provider secrets as strict mode", () => {
    expect(shouldExpectStrictProviderSecrets({ NODE_ENV: "production" })).toBe(true);
    expect(
      shouldExpectStrictProviderSecrets({
        NODE_ENV: "test",
        TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS: "true"
      })
    ).toBe(true);
    expect(
      shouldExpectStrictProviderSecrets({
        NODE_ENV: "production",
        PROVIDER_ROUTING_REHEARSAL_EXPECT_STRICT: "false"
      })
    ).toBe(false);
  });

  it("returns blocker evidence for missing tenant provider secrets", async () => {
    const client = {
      query: vi.fn((sql: string) => {
        if (sql.includes("provider-routing:resend.webhook_secret_missing:count")) {
          return Promise.resolve({ rows: [{ count: "1" }] });
        }
        if (sql.includes("provider-routing:resend.webhook_secret_missing:sample")) {
          return Promise.resolve({ rows: [{ sample_id: "scope=tenant-a:workspace-a" }] });
        }
        if (sql.includes(":count")) {
          return Promise.resolve({ rows: [{ count: "0" }] });
        }
        return Promise.resolve({ rows: [] });
      })
    };

    const report = await runProviderRoutingRehearsal(
      client,
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        sampleLimit: 1
      },
      {
        NODE_ENV: "production",
        TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS: "true",
        DATABASE_URL: "postgres://example"
      }
    );

    expect(report.ready).toBe(false);
    expect(report.blockerCount).toBe(1);
    expect(report.summary.missingProviderSecretRows).toBe(1);
    expect(report.writesDatabase).toBe(false);
    expect(report.secretsRedacted).toBe(true);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        key: "resend.webhook_secret_missing",
        severity: "blocker",
        sampleIds: ["scope=tenant-a:workspace-a"]
      })
    );
  });

  it("writes redacted rehearsal evidence to disk", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "provider-routing-rehearsal-"));
    const outputPath = path.join(outputDir, "evidence.json");

    try {
      await writeRehearsalEvidence(
        {
          formatVersion: "provider-routing-rehearsal.v1",
          reportId: "report-1",
          ready: true,
          checks: [],
          secretsRedacted: true,
          writesDatabase: false
        },
        outputPath
      );

      const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      expect(written).toMatchObject({
        formatVersion: "provider-routing-rehearsal.v1",
        reportId: "report-1",
        secretsRedacted: true,
        writesDatabase: false
      });
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
