const { tenantIngressHeaders } = require("./tenant-ingress-headers");
const fs = require("fs");
const path = require("path");

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function shouldExpectStrictSignatures(env = process.env) {
  const configured = parseBoolean(env.TENANT_INGRESS_DRILL_EXPECT_STRICT, null);
  if (configured !== null) return configured;
  const signatureRequired = parseBoolean(env.TENANT_INGRESS_REQUIRE_SIGNATURE, null);
  if (signatureRequired !== null) return signatureRequired;
  return env.NODE_ENV === "production";
}

function safeJsonParse(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return { raw: value };
  }
}

async function readResponse(response) {
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: safeJsonParse(text),
    raw: text
  };
}

function pathAndQuery(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return value;
  }
}

function evidenceFileName(date) {
  return `tenant-ingress-signature-drill-${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

function resolveEvidencePath({ env, generatedAt, argv = process.argv.slice(2) }) {
  const pathFlagIndex = argv.indexOf("--evidence-path");
  if (pathFlagIndex >= 0 && argv[pathFlagIndex + 1]) {
    return argv[pathFlagIndex + 1];
  }
  const dirFlagIndex = argv.indexOf("--evidence-dir");
  const configuredDir =
    dirFlagIndex >= 0 && argv[dirFlagIndex + 1]
      ? argv[dirFlagIndex + 1]
      : env.TENANT_INGRESS_DRILL_EVIDENCE_DIR;
  if (!configuredDir) {
    return env.TENANT_INGRESS_DRILL_EVIDENCE_PATH || null;
  }
  return path.join(configuredDir, evidenceFileName(generatedAt));
}

function buildEvidence({
  env,
  generatedAt,
  strictExpected,
  freshUrl,
  replayUrl,
  fresh,
  replay,
  status = "passed",
  error = null
}) {
  return {
    schemaVersion: 1,
    evidenceType: "tenant_ingress_signature_drill",
    generatedAt: generatedAt.toISOString(),
    status,
    appUrl: env.APP_URL?.replace(/\/+$/, "") ?? null,
    nodeEnv: env.NODE_ENV ?? null,
    tenantKey: env.TENANT_INGRESS_TENANT ?? null,
    workspaceKey: env.TENANT_INGRESS_WORKSPACE ?? null,
    strictExpected,
    requirements: {
      scopeRequired: parseBoolean(env.TENANT_INGRESS_REQUIRE_SCOPE, null),
      signatureRequired: parseBoolean(env.TENANT_INGRESS_REQUIRE_SIGNATURE, null),
      allowGlobalSigningSecret: parseBoolean(env.TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET, null)
    },
    checks: {
      freshSignedRequest: fresh
        ? {
            method: "GET",
            path: pathAndQuery(freshUrl),
            status: fresh.status,
            ok: fresh.ok
          }
        : null,
      pathQueryReplay: replay
        ? {
            method: "GET",
            signedPath: pathAndQuery(freshUrl),
            replayPath: pathAndQuery(replayUrl),
            status: replay.status,
            rejected: replay.status === 401
          }
        : null
    },
    secretsRedacted: true,
    error: error ? { message: String(error.message || error) } : null
  };
}

function writeDrillEvidence(evidence, outputPath) {
  if (!outputPath) return null;
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return resolved;
}

async function signedFetch({ url, method, secret, fetchImpl }) {
  const response = await fetchImpl(url, {
    method,
    headers: tenantIngressHeaders({
      url,
      method,
      headers: { "x-6esk-secret": secret }
    })
  });
  return readResponse(response);
}

async function runTenantIngressSignatureDrill({
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date()
} = {}) {
  const baseUrl = env.APP_URL?.replace(/\/+$/, "") ?? "";
  const secret = env.INBOUND_SHARED_SECRET ?? "";
  if (!baseUrl || !secret) {
    throw new Error("APP_URL and INBOUND_SHARED_SECRET are required");
  }

  const strictExpected = shouldExpectStrictSignatures(env);
  const generatedAt = now();
  const freshUrl = `${baseUrl}/api/admin/inbound/metrics?hours=1`;
  const replayUrl = `${baseUrl}/api/admin/inbound/metrics?hours=2`;

  const fresh = await signedFetch({
    url: freshUrl,
    method: "GET",
    secret,
    fetchImpl
  });
  if (!fresh.ok) {
    throw new Error(`Fresh signed tenant ingress failed (${fresh.status}): ${fresh.raw}`);
  }

  const replayHeaders = tenantIngressHeaders({
    url: freshUrl,
    method: "GET",
    headers: { "x-6esk-secret": secret }
  });
  const replayResponse = await fetchImpl(replayUrl, {
    method: "GET",
    headers: replayHeaders
  });
  const replay = await readResponse(replayResponse);

  if (strictExpected && replay.status !== 401) {
    throw new Error(
      `Path/query replay expected 401 under strict signatures but got ${replay.status}: ${replay.raw}`
    );
  }

  const evidence = buildEvidence({
    env,
    generatedAt,
    strictExpected,
    freshUrl,
    replayUrl,
    fresh,
    replay
  });

  return {
    strictExpected,
    freshStatus: fresh.status,
    replayStatus: replay.status,
    replayRejected: replay.status === 401,
    evidence
  };
}

async function main() {
  const generatedAt = new Date();
  try {
    const result = await runTenantIngressSignatureDrill({
      now: () => generatedAt
    });
    const evidencePath = resolveEvidencePath({
      env: process.env,
      generatedAt
    });
    const writtenPath = writeDrillEvidence(result.evidence, evidencePath);
    console.log(
      "Tenant ingress signature drill complete:",
      JSON.stringify(
        {
          strictExpected: result.strictExpected,
          freshStatus: result.freshStatus,
          replayStatus: result.replayStatus,
          replayRejected: result.replayRejected,
          evidencePath: writtenPath
        },
        null,
        2
      )
    );
  } catch (error) {
    const evidencePath = resolveEvidencePath({
      env: process.env,
      generatedAt
    });
    const failureEvidence = buildEvidence({
      env: process.env,
      generatedAt,
      strictExpected: shouldExpectStrictSignatures(process.env),
      freshUrl: `${process.env.APP_URL?.replace(/\/+$/, "") ?? ""}/api/admin/inbound/metrics?hours=1`,
      replayUrl: `${process.env.APP_URL?.replace(/\/+$/, "") ?? ""}/api/admin/inbound/metrics?hours=2`,
      fresh: null,
      replay: null,
      status: "failed",
      error
    });
    const writtenPath = writeDrillEvidence(failureEvidence, evidencePath);
    if (writtenPath) {
      console.error(`Tenant ingress signature drill evidence written: ${writtenPath}`);
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildEvidence,
  runTenantIngressSignatureDrill,
  shouldExpectStrictSignatures,
  writeDrillEvidence
};
