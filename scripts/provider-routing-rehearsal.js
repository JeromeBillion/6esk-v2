const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { Client } = require("pg");

const FORMAT_VERSION = "provider-routing-rehearsal.v1";

function parseBoolean(value, fallback = null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function shouldExpectStrictProviderSecrets(env = process.env) {
  const configured = parseBoolean(env.PROVIDER_ROUTING_REHEARSAL_EXPECT_STRICT, null);
  if (configured !== null) return configured;
  const tenantProviderStrict = parseBoolean(env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS, null);
  if (tenantProviderStrict !== null) return tenantProviderStrict;
  return env.NODE_ENV === "production";
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    tenantKey: env.PROVIDER_ROUTING_REHEARSAL_TENANT || "",
    workspaceKey: env.PROVIDER_ROUTING_REHEARSAL_WORKSPACE || "",
    sampleLimit: 10,
    includePassed: false,
    json: false,
    output: env.PROVIDER_ROUTING_REHEARSAL_OUTPUT || null,
    evidenceDir: env.PROVIDER_ROUTING_REHEARSAL_EVIDENCE_DIR || null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inlineValue] = arg.split("=", 2);
    const readValue = () => {
      if (inlineValue != null) return inlineValue;
      index += 1;
      return argv[index];
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (name === "--tenant") {
      options.tenantKey = readValue();
      continue;
    }
    if (name === "--workspace") {
      options.workspaceKey = readValue();
      continue;
    }
    if (name === "--sample-limit") {
      options.sampleLimit = Number.parseInt(readValue(), 10);
      continue;
    }
    if (arg === "--include-passed") {
      options.includePassed = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (name === "--output") {
      options.output = readValue();
      continue;
    }
    if (name === "--evidence-dir") {
      options.evidenceDir = readValue();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.tenantKey = String(options.tenantKey || "").trim();
  options.workspaceKey = String(options.workspaceKey || "").trim();
  if ((options.tenantKey && !options.workspaceKey) || (!options.tenantKey && options.workspaceKey)) {
    throw new Error("--tenant and --workspace must be supplied together");
  }
  if (!Number.isFinite(options.sampleLimit) || options.sampleLimit < 1 || options.sampleLimit > 25) {
    throw new Error("--sample-limit must be an integer from 1 to 25");
  }
  options.sampleLimit = Math.trunc(options.sampleLimit);
  return options;
}

function helpText() {
  return [
    "Usage: node scripts/provider-routing-rehearsal.js [options]",
    "       npm run rehearse:provider-routing -- --tenant=<key> --workspace=<key>",
    "",
    "Runs a read-only production provider-routing rehearsal against DATABASE_URL.",
    "The report checks ambiguous route ownership and missing tenant-scoped provider secrets.",
    "",
    "Options:",
    "  --tenant=<key>              Limit checks to route keys used by one tenant/workspace.",
    "  --workspace=<key>           Required when --tenant is supplied.",
    "  --sample-limit=1..25        Sample identifiers per failing check. Default: 10.",
    "  --include-passed            Include zero-count checks in the report.",
    "  --json                      Print JSON instead of human summary.",
    "  --output=path               Write the full JSON report to a file.",
    "  --evidence-dir=path         Write a timestamped JSON report under the directory."
  ].join("\n");
}

function scopeFilter(alias, options, params) {
  if (!options.tenantKey && !options.workspaceKey) {
    return "";
  }
  params.push(options.tenantKey);
  const tenantParam = `$${params.length}`;
  params.push(options.workspaceKey);
  const workspaceParam = `$${params.length}`;
  return ` AND ${alias}.tenant_key = ${tenantParam} AND ${alias}.workspace_key = ${workspaceParam}`;
}

function limitParam(params) {
  return `$${params.length + 1}`;
}

function definition({
  key,
  provider,
  check,
  severity = "blocker",
  description,
  countSql,
  sampleSql,
  params = []
}) {
  return { key, provider, check, severity, description, countSql, sampleSql, params };
}

function activeSecretPredicate(alias, provider, secretType) {
  return `${alias}.provider = '${provider}'
    AND ${alias}.secret_type = '${secretType}'
    AND ${alias}.status IN ('active', 'retiring')
    AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > now())`;
}

function buildEmailAddressAmbiguity(options) {
  const params = [];
  const targetScope = scopeFilter("m", options, params);
  const targetCte = targetScope
    ? `target_routes AS (
         SELECT DISTINCT lower(m.address) AS route_key
         FROM mailboxes m
         WHERE m.address IS NOT NULL
           AND btrim(m.address) <> ''
           ${targetScope}
       ),`
    : "";
  const targetJoin = targetScope ? "JOIN target_routes target ON target.route_key = lower(m.address)" : "";
  const grouped = `
    ${targetCte}
    route_groups AS (
      SELECT lower(m.address) AS route_key,
             array_agg(DISTINCT m.tenant_key || ':' || m.workspace_key ORDER BY m.tenant_key || ':' || m.workspace_key) AS scopes
      FROM mailboxes m
      ${targetJoin}
      WHERE m.address IS NOT NULL
        AND btrim(m.address) <> ''
      GROUP BY lower(m.address)
      HAVING COUNT(DISTINCT m.tenant_key || ':' || m.workspace_key) > 1
    )`;
  return definition({
    key: "resend.mailbox_address_ambiguous",
    provider: "resend",
    check: "ambiguous_route",
    description: "Inbound email recipient addresses must resolve to only one tenant/workspace route.",
    params,
    countSql: `/* provider-routing:resend.mailbox_address_ambiguous:count */ WITH ${grouped} SELECT COUNT(*)::text AS count FROM route_groups`,
    sampleSql: `/* provider-routing:resend.mailbox_address_ambiguous:sample */ WITH ${grouped}
      SELECT 'email:' || substr(md5(route_key), 1, 12) || ' scopes=' || array_to_string(scopes, ',') AS sample_id
      FROM route_groups
      ORDER BY route_key
      LIMIT ${limitParam(params)}`
  });
}

function buildResendSecretMissing(options) {
  const params = [];
  const filter = scopeFilter("m", options, params);
  const grouped = `
    mailbox_scopes AS (
      SELECT DISTINCT m.tenant_key, m.workspace_key
      FROM mailboxes m
      WHERE m.tenant_key IS NOT NULL
        AND m.workspace_key IS NOT NULL
        ${filter}
    ),
    missing AS (
      SELECT m.tenant_key, m.workspace_key
      FROM mailbox_scopes m
      WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_provider_webhook_secrets s
        WHERE s.tenant_key = m.tenant_key
          AND s.workspace_key = m.workspace_key
          AND ${activeSecretPredicate("s", "resend", "webhook_secret")}
      )
    )`;
  return definition({
    key: "resend.webhook_secret_missing",
    provider: "resend",
    check: "missing_provider_secret",
    description: "Every workspace receiving Resend email webhooks needs an active tenant-scoped resend/webhook_secret.",
    params,
    countSql: `/* provider-routing:resend.webhook_secret_missing:count */ WITH ${grouped} SELECT COUNT(*)::text AS count FROM missing`,
    sampleSql: `/* provider-routing:resend.webhook_secret_missing:sample */ WITH ${grouped}
      SELECT 'scope=' || tenant_key || ':' || workspace_key AS sample_id
      FROM missing
      ORDER BY tenant_key, workspace_key
      LIMIT ${limitParam(params)}`
  });
}

function buildWhatsAppAmbiguity({ key, routeColumn, routeExpression, routeWhere }, options) {
  const params = [];
  const targetScope = scopeFilter("w", options, params);
  const targetCte = targetScope
    ? `target_routes AS (
         SELECT DISTINCT ${routeExpression("w")} AS route_key
         FROM whatsapp_accounts w
         WHERE ${routeWhere("w")}
           ${targetScope}
       ),`
    : "";
  const targetJoin = targetScope ? `JOIN target_routes target ON target.route_key = ${routeExpression("w")}` : "";
  const grouped = `
    ${targetCte}
    route_groups AS (
      SELECT ${routeExpression("w")} AS route_key,
             array_agg(DISTINCT w.tenant_key || ':' || w.workspace_key ORDER BY w.tenant_key || ':' || w.workspace_key) AS scopes
      FROM whatsapp_accounts w
      ${targetJoin}
      WHERE ${routeWhere("w")}
      GROUP BY ${routeExpression("w")}
      HAVING COUNT(DISTINCT w.tenant_key || ':' || w.workspace_key) > 1
    )`;
  return definition({
    key,
    provider: "whatsapp",
    check: "ambiguous_route",
    description: `WhatsApp ${routeColumn} route keys must resolve to only one tenant/workspace.`,
    params,
    countSql: `/* provider-routing:${key}:count */ WITH ${grouped} SELECT COUNT(*)::text AS count FROM route_groups`,
    sampleSql: `/* provider-routing:${key}:sample */ WITH ${grouped}
      SELECT 'whatsapp:${routeColumn}:' || substr(md5(route_key), 1, 12) || ' scopes=' || array_to_string(scopes, ',') AS sample_id
      FROM route_groups
      ORDER BY route_key
      LIMIT ${limitParam(params)}`
  });
}

function buildWhatsAppSecretMissing(options) {
  const params = [];
  const filter = scopeFilter("w", options, params);
  const grouped = `
    whatsapp_scopes AS (
      SELECT DISTINCT w.tenant_key, w.workspace_key
      FROM whatsapp_accounts w
      WHERE w.status = 'active'
        ${filter}
    ),
    missing AS (
      SELECT w.tenant_key, w.workspace_key
      FROM whatsapp_scopes w
      WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_provider_webhook_secrets s
        WHERE s.tenant_key = w.tenant_key
          AND s.workspace_key = w.workspace_key
          AND ${activeSecretPredicate("s", "whatsapp", "app_secret")}
      )
    )`;
  return definition({
    key: "whatsapp.app_secret_missing",
    provider: "whatsapp",
    check: "missing_provider_secret",
    description: "Every active WhatsApp account scope needs an active tenant-scoped whatsapp/app_secret.",
    params,
    countSql: `/* provider-routing:whatsapp.app_secret_missing:count */ WITH ${grouped} SELECT COUNT(*)::text AS count FROM missing`,
    sampleSql: `/* provider-routing:whatsapp.app_secret_missing:sample */ WITH ${grouped}
      SELECT 'scope=' || tenant_key || ':' || workspace_key AS sample_id
      FROM missing
      ORDER BY tenant_key, workspace_key
      LIMIT ${limitParam(params)}`
  });
}

function buildTwilioAmbiguity({ key, routeColumn, routeExpression, routeWhere }, options) {
  const params = [];
  const targetScope = scopeFilter("n", options, params);
  const targetCte = targetScope
    ? `target_routes AS (
         SELECT DISTINCT n.provider || ':' || ${routeExpression("n")} AS route_key
         FROM call_provider_numbers n
         WHERE n.status = 'active'
           AND ${routeWhere("n")}
           ${targetScope}
       ),`
    : "";
  const targetJoin = targetScope
    ? `JOIN target_routes target ON target.route_key = n.provider || ':' || ${routeExpression("n")}`
    : "";
  const grouped = `
    ${targetCte}
    route_groups AS (
      SELECT n.provider || ':' || ${routeExpression("n")} AS route_key,
             array_agg(DISTINCT n.tenant_key || ':' || n.workspace_key ORDER BY n.tenant_key || ':' || n.workspace_key) AS scopes
      FROM call_provider_numbers n
      ${targetJoin}
      WHERE n.status = 'active'
        AND ${routeWhere("n")}
      GROUP BY n.provider || ':' || ${routeExpression("n")}
      HAVING COUNT(DISTINCT n.tenant_key || ':' || n.workspace_key) > 1
    )`;
  return definition({
    key,
    provider: "twilio",
    check: "ambiguous_route",
    description: `Active Twilio ${routeColumn} route keys must resolve to only one tenant/workspace.`,
    params,
    countSql: `/* provider-routing:${key}:count */ WITH ${grouped} SELECT COUNT(*)::text AS count FROM route_groups`,
    sampleSql: `/* provider-routing:${key}:sample */ WITH ${grouped}
      SELECT 'twilio:${routeColumn}:' || substr(md5(route_key), 1, 12) || ' scopes=' || array_to_string(scopes, ',') AS sample_id
      FROM route_groups
      ORDER BY route_key
      LIMIT ${limitParam(params)}`
  });
}

function buildTwilioSecretMissing(options) {
  const params = [];
  const filter = scopeFilter("n", options, params);
  const grouped = `
    active_numbers AS (
      SELECT n.tenant_key, n.workspace_key, n.provider, n.phone_number, n.account_sid
      FROM call_provider_numbers n
      WHERE n.status = 'active'
        AND n.provider = 'twilio'
        ${filter}
    ),
    missing AS (
      SELECT n.tenant_key, n.workspace_key, n.account_sid, n.phone_number
      FROM active_numbers n
      WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_provider_webhook_secrets s
        WHERE s.tenant_key = n.tenant_key
          AND s.workspace_key = n.workspace_key
          AND ${activeSecretPredicate("s", "twilio", "auth_token")}
          AND (s.provider_account_id IS NULL OR (n.account_sid IS NOT NULL AND s.provider_account_id = n.account_sid))
      )
    )`;
  return definition({
    key: "twilio.auth_token_missing",
    provider: "twilio",
    check: "missing_provider_secret",
    description: "Every active Twilio provider number needs an active tenant-scoped twilio/auth_token secret.",
    params,
    countSql: `/* provider-routing:twilio.auth_token_missing:count */ WITH ${grouped} SELECT COUNT(*)::text AS count FROM missing`,
    sampleSql: `/* provider-routing:twilio.auth_token_missing:sample */ WITH ${grouped}
      SELECT 'scope=' || tenant_key || ':' || workspace_key
        || ' phone=' || substr(md5(phone_number), 1, 12)
        || ' account=' || COALESCE(substr(md5(account_sid), 1, 12), 'none') AS sample_id
      FROM missing
      ORDER BY tenant_key, workspace_key, phone_number
      LIMIT ${limitParam(params)}`
  });
}

function buildManagedSttSecretMissing(options, { key, provider, secretType }) {
  const params = [];
  const filter = scopeFilter("n", options, params);
  const grouped = `
    voice_scopes AS (
      SELECT DISTINCT n.tenant_key, n.workspace_key
      FROM call_provider_numbers n
      WHERE n.status = 'active'
        ${filter}
    ),
    missing AS (
      SELECT v.tenant_key, v.workspace_key
      FROM voice_scopes v
      WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_provider_webhook_secrets s
        WHERE s.tenant_key = v.tenant_key
          AND s.workspace_key = v.workspace_key
          AND ${activeSecretPredicate("s", provider, secretType)}
      )
    )`;
  return definition({
    key,
    provider,
    check: "missing_provider_secret",
    description: `Every voice-enabled workspace needs an active tenant-scoped ${provider}/${secretType} secret.`,
    params,
    countSql: `/* provider-routing:${key}:count */ WITH ${grouped} SELECT COUNT(*)::text AS count FROM missing`,
    sampleSql: `/* provider-routing:${key}:sample */ WITH ${grouped}
      SELECT 'scope=' || tenant_key || ':' || workspace_key AS sample_id
      FROM missing
      ORDER BY tenant_key, workspace_key
      LIMIT ${limitParam(params)}`
  });
}

function buildPublicOriginAmbiguity(options) {
  const params = [];
  const targetScope = scopeFilter("o", options, params);
  const targetCte = targetScope
    ? `target_routes AS (
         SELECT DISTINCT lower(o.origin) AS route_key
         FROM tenant_public_ingress_origins o
         WHERE o.status = 'active'
           AND o.origin IS NOT NULL
           AND btrim(o.origin) <> ''
           ${targetScope}
       ),`
    : "";
  const targetJoin = targetScope ? "JOIN target_routes target ON target.route_key = lower(o.origin)" : "";
  const grouped = `
    ${targetCte}
    route_groups AS (
      SELECT lower(o.origin) AS route_key,
             array_agg(DISTINCT o.tenant_key || ':' || o.workspace_key ORDER BY o.tenant_key || ':' || o.workspace_key) AS scopes
      FROM tenant_public_ingress_origins o
      ${targetJoin}
      WHERE o.status = 'active'
        AND o.origin IS NOT NULL
        AND btrim(o.origin) <> ''
      GROUP BY lower(o.origin)
      HAVING COUNT(DISTINCT o.tenant_key || ':' || o.workspace_key) > 1
    )`;
  return definition({
    key: "public_origin.origin_ambiguous",
    provider: "public_origin",
    check: "ambiguous_route",
    description: "Active public portal/webchat origins must resolve to only one tenant/workspace.",
    params,
    countSql: `/* provider-routing:public_origin.origin_ambiguous:count */ WITH ${grouped} SELECT COUNT(*)::text AS count FROM route_groups`,
    sampleSql: `/* provider-routing:public_origin.origin_ambiguous:sample */ WITH ${grouped}
      SELECT 'origin:' || substr(md5(route_key), 1, 12) || ' scopes=' || array_to_string(scopes, ',') AS sample_id
      FROM route_groups
      ORDER BY route_key
      LIMIT ${limitParam(params)}`
  });
}

function buildPublicOriginMissing(options) {
  if (!options.tenantKey || !options.workspaceKey) {
    return null;
  }
  const params = [options.tenantKey, options.workspaceKey];
  const grouped = `
    missing AS (
      SELECT $1::text AS tenant_key, $2::text AS workspace_key
      WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_public_ingress_origins o
        WHERE o.tenant_key = $1
          AND o.workspace_key = $2
          AND o.status = 'active'
      )
    )`;
  return definition({
    key: "public_origin.active_origin_missing",
    provider: "public_origin",
    check: "missing_public_origin",
    description: "A tenant/workspace external public portal launch needs at least one active trusted origin.",
    params,
    countSql: `/* provider-routing:public_origin.active_origin_missing:count */ WITH ${grouped} SELECT COUNT(*)::text AS count FROM missing`,
    sampleSql: `/* provider-routing:public_origin.active_origin_missing:sample */ WITH ${grouped}
      SELECT 'scope=' || tenant_key || ':' || workspace_key AS sample_id
      FROM missing
      LIMIT ${limitParam(params)}`
  });
}

function buildStrictModeDefinition(env = process.env) {
  const strictExpected = shouldExpectStrictProviderSecrets(env);
  const count = strictExpected ? "0" : "1";
  return definition({
    key: "runtime.strict_provider_secret_mode",
    provider: "runtime",
    check: "strict_mode",
    severity: "warning",
    description: "External launch rehearsal should run with production or TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS=true.",
    countSql: `/* provider-routing:runtime.strict_provider_secret_mode:count */ SELECT ${count}::text AS count`,
    sampleSql:
      "/* provider-routing:runtime.strict_provider_secret_mode:sample */ SELECT 'strict provider webhook secret mode is not enabled' AS sample_id LIMIT $1"
  });
}

function buildRehearsalDefinitions(options = {}, env = process.env) {
  return [
    buildStrictModeDefinition(env),
    buildEmailAddressAmbiguity(options),
    buildResendSecretMissing(options),
    buildWhatsAppAmbiguity(
      {
        key: "whatsapp.waba_ambiguous",
        routeColumn: "waba_id",
        routeExpression: (alias) => `${alias}.waba_id`,
        routeWhere: (alias) => `${alias}.waba_id IS NOT NULL AND btrim(${alias}.waba_id) <> ''`
      },
      options
    ),
    buildWhatsAppAmbiguity(
      {
        key: "whatsapp.phone_ambiguous",
        routeColumn: "phone",
        routeExpression: (alias) => `regexp_replace(${alias}.phone_number, '\\s+', '', 'g')`,
        routeWhere: (alias) => `${alias}.phone_number IS NOT NULL AND btrim(${alias}.phone_number) <> ''`
      },
      options
    ),
    buildWhatsAppSecretMissing(options),
    buildTwilioAmbiguity(
      {
        key: "twilio.phone_ambiguous",
        routeColumn: "phone",
        routeExpression: (alias) => `regexp_replace(${alias}.phone_number, '\\s+', '', 'g')`,
        routeWhere: (alias) => `${alias}.phone_number IS NOT NULL AND btrim(${alias}.phone_number) <> ''`
      },
      options
    ),
    buildTwilioAmbiguity(
      {
        key: "twilio.account_sid_ambiguous",
        routeColumn: "account_sid",
        routeExpression: (alias) => `${alias}.account_sid`,
        routeWhere: (alias) => `${alias}.account_sid IS NOT NULL AND btrim(${alias}.account_sid) <> ''`
      },
      options
    ),
    buildTwilioSecretMissing(options),
    buildManagedSttSecretMissing(options, {
      key: "managed_stt.http_secret_missing",
      provider: "managed_stt",
      secretType: "http_secret"
    }),
    buildManagedSttSecretMissing(options, {
      key: "deepgram.callback_token_missing",
      provider: "deepgram",
      secretType: "callback_token"
    }),
    buildPublicOriginAmbiguity(options),
    buildPublicOriginMissing(options)
  ].filter(Boolean);
}

function readCount(value) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readError(error) {
  return error instanceof Error ? error.message : "Unknown rehearsal query failure";
}

async function runDefinition(client, item, sampleLimit) {
  try {
    const countResult = await client.query(item.countSql, item.params);
    const count = readCount(countResult.rows[0] && countResult.rows[0].count);
    const sampleResult =
      count > 0
        ? await client.query(item.sampleSql, [...item.params, sampleLimit])
        : { rows: [] };
    return {
      key: item.key,
      provider: item.provider,
      check: item.check,
      severity: item.severity,
      count,
      sampleIds: sampleResult.rows.map((row) => String(row.sample_id || "")).filter(Boolean),
      description: item.description
    };
  } catch (error) {
    return {
      key: item.key,
      provider: item.provider,
      check: item.check,
      severity: "blocker",
      count: 1,
      sampleIds: [],
      description: `${item.description} The rehearsal query failed, so provider routing readiness cannot be proven.`,
      error: readError(error)
    };
  }
}

function summarize(failedChecks) {
  const sum = (check) =>
    failedChecks.filter((item) => item.check === check).reduce((total, item) => total + item.count, 0);
  return {
    ambiguousRouteRows: sum("ambiguous_route"),
    missingProviderSecretRows: sum("missing_provider_secret"),
    missingPublicOriginRows: sum("missing_public_origin"),
    strictModeWarnings: sum("strict_mode")
  };
}

async function runProviderRoutingRehearsal(client, options = {}, env = process.env) {
  const normalized = {
    tenantKey: options.tenantKey || "",
    workspaceKey: options.workspaceKey || "",
    sampleLimit: options.sampleLimit || 10,
    includePassed: Boolean(options.includePassed)
  };
  const definitions = buildRehearsalDefinitions(normalized, env);
  const allChecks = [];

  for (const item of definitions) {
    allChecks.push(await runDefinition(client, item, normalized.sampleLimit));
  }

  const failedChecks = allChecks.filter((check) => check.count > 0);
  const blockerCount = failedChecks.filter((check) => check.severity === "blocker").length;
  const warningCount = failedChecks.filter((check) => check.severity === "warning").length;
  const infoCount = failedChecks.filter((check) => check.severity === "info").length;

  return {
    formatVersion: FORMAT_VERSION,
    reportId: randomUUID(),
    generatedAt: new Date().toISOString(),
    evidenceType: "provider_routing_rehearsal",
    mode: "read_only",
    ready: blockerCount === 0,
    strictExpected: shouldExpectStrictProviderSecrets(env),
    scope: normalized.tenantKey
      ? { tenantKey: normalized.tenantKey, workspaceKey: normalized.workspaceKey }
      : { tenantKey: null, workspaceKey: null },
    requirements: {
      providerSecretsRequired: parseBoolean(env.TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS, null),
      nodeEnv: env.NODE_ENV || null,
      databaseUrlConfigured: Boolean(env.DATABASE_URL)
    },
    blockerCount,
    warningCount,
    infoCount,
    evaluatedCheckCount: allChecks.length,
    failedCheckCount: failedChecks.length,
    passedCheckCount: allChecks.length - failedChecks.length,
    sampleLimit: normalized.sampleLimit,
    checks: normalized.includePassed ? allChecks : failedChecks,
    summary: summarize(failedChecks),
    writesDatabase: false,
    secretsRedacted: true
  };
}

function evidenceFileName(date = new Date()) {
  return `provider-routing-rehearsal-${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

function resolveOutputPath(options) {
  if (options.output) {
    return path.resolve(options.output);
  }
  if (options.evidenceDir) {
    return path.join(path.resolve(options.evidenceDir), evidenceFileName());
  }
  return null;
}

async function writeRehearsalEvidence(report, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

function printSummary(report, outputPath = null) {
  console.log(`Provider routing rehearsal ${report.reportId}`);
  console.log(`Ready: ${report.ready ? "yes" : "no"}`);
  console.log(`Scope: ${report.scope.tenantKey ? `${report.scope.tenantKey}/${report.scope.workspaceKey}` : "all"}`);
  console.log(
    `Checks: ${report.evaluatedCheckCount} evaluated, ${report.failedCheckCount} failed, ${report.blockerCount} blockers, ${report.warningCount} warnings`
  );
  if (report.checks.length > 0) {
    console.log("");
    for (const check of report.checks) {
      const samples = check.sampleIds.length ? ` samples=${check.sampleIds.join(",")}` : "";
      const error = check.error ? ` error=${check.error}` : "";
      console.log(`[${check.severity}] ${check.key}: count=${check.count}${samples}${error}`);
    }
  }
  if (outputPath) {
    console.log("");
    console.log(`Evidence: ${outputPath}`);
  }
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log(helpText());
    return 0;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run provider routing rehearsal");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const report = await runProviderRoutingRehearsal(client, options);
    const outputPath = resolveOutputPath(options);
    if (outputPath) {
      await writeRehearsalEvidence(report, outputPath);
    }
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printSummary(report, outputPath);
    }
    return report.ready ? 0 : 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 2;
    });
}

module.exports = {
  buildRehearsalDefinitions,
  helpText,
  parseArgs,
  runProviderRoutingRehearsal,
  shouldExpectStrictProviderSecrets,
  writeRehearsalEvidence
};
