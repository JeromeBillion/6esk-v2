const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { Client } = require("pg");

const FORMAT_VERSION = "tenant-offboarding-rehearsal.v1";

const TENANT_TABLES = [
  "tenants",
  "organizations",
  "agent_integrations"
];

const WORKSPACE_TABLES = [
  "workspaces",
  "tenant_security_policies",
  "workspace_modules",
  "workspace_module_usage_events",
  "users",
  "auth_sessions",
  "auth_identity_accounts",
  "auth_mfa_factors",
  "auth_mfa_enrollments",
  "auth_mfa_challenges",
  "password_resets",
  "mailboxes",
  "mailbox_memberships",
  "customers",
  "customer_identities",
  "tickets",
  "messages",
  "attachments",
  "ticket_events",
  "replies",
  "audit_logs",
  "privileged_access_grants",
  "sla_configs",
  "csat_ratings",
  "ticket_merges",
  "customer_merges",
  "merge_review_tasks",
  "ticket_links",
  "external_user_links",
  "tags",
  "ticket_tags",
  "macros",
  "support_saved_views",
  "inbound_events",
  "inbound_alerts",
  "inbound_alert_configs",
  "spam_rules",
  "whatsapp_accounts",
  "whatsapp_events",
  "whatsapp_templates",
  "whatsapp_status_events",
  "email_outbox_events",
  "call_provider_numbers",
  "tenant_ingress_signing_secrets",
  "tenant_provider_webhook_secrets",
  "tenant_public_ingress_origins",
  "call_sessions",
  "call_events",
  "call_outbox_events",
  "call_transcript_jobs",
  "call_transcript_ai_jobs",
  "voice_operator_presence",
  "voice_consent_events",
  "call_review_writebacks",
  "agent_outbox",
  "agent_runs",
  "agent_run_events",
  "agent_run_steps",
  "agent_tool_calls",
  "agent_drafts",
  "ai_guard_events",
  "ai_policy_decisions",
  "ai_knowledge_folders",
  "ai_knowledge_documents",
  "ai_knowledge_chunks",
  "ai_knowledge_retrieval_events",
  "ai_knowledge_quarantine_events",
  "ai_prompt_templates",
  "ai_prompt_template_events"
];

const OBJECT_REF_COLUMNS = [
  { table: "messages", column: "r2_key_raw" },
  { table: "messages", column: "r2_key_html" },
  { table: "messages", column: "r2_key_text" },
  { table: "attachments", column: "r2_key" },
  { table: "call_sessions", column: "recording_r2_key" },
  { table: "call_sessions", column: "transcript_r2_key" },
  { table: "ai_knowledge_quarantine_events", column: "storage_key" }
];

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    tenantKey: env.TENANT_OFFBOARDING_REHEARSAL_TENANT || "",
    workspaceKey: env.TENANT_OFFBOARDING_REHEARSAL_WORKSPACE || "",
    mode: env.TENANT_OFFBOARDING_REHEARSAL_MODE || "anonymize",
    includePassed: false,
    json: false,
    output: env.TENANT_OFFBOARDING_REHEARSAL_OUTPUT || null,
    evidenceDir: env.TENANT_OFFBOARDING_REHEARSAL_EVIDENCE_DIR || null,
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
    if (name === "--mode") {
      options.mode = readValue();
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
  options.mode = String(options.mode || "").trim();
  if (!options.tenantKey) throw new Error("--tenant is required");
  if (!options.workspaceKey) throw new Error("--workspace is required");
  if (!["anonymize", "delete"].includes(options.mode)) {
    throw new Error("--mode must be anonymize or delete");
  }
  return options;
}

function helpText() {
  return [
    "Usage: node scripts/tenant-offboarding-rehearsal.js --tenant=<key> --workspace=<key> [options]",
    "       npm run rehearse:tenant-offboarding -- --tenant=<key> --workspace=<key>",
    "",
    "Runs a read-only tenant offboarding rehearsal against DATABASE_URL.",
    "The report proves target scope, row-count coverage, legal-hold blockers, and R2 object-reference exposure before privileged anonymization/delete work.",
    "",
    "Options:",
    "  --tenant=<key>              Required tenant key.",
    "  --workspace=<key>           Required workspace key.",
    "  --mode=anonymize|delete     Planned mode. Physical delete is reported as blocked. Default: anonymize.",
    "  --include-passed            Include passed/zero-count checks in the report.",
    "  --json                      Print JSON instead of human summary.",
    "  --output=path               Write the full JSON report to a file.",
    "  --evidence-dir=path         Write a timestamped JSON report under the directory."
  ].join("\n");
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function tableName(table) {
  return quoteIdent(table.name);
}

function hasColumn(table, column) {
  return Boolean(table && table.columns.includes(column));
}

async function loadCatalog(client) {
  const tableResult = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  const columnResult = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  const columnsByTable = new Map();
  for (const row of columnResult.rows) {
    const columns = columnsByTable.get(row.table_name) || [];
    columns.push(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  return {
    tables: tableResult.rows.map((row) => ({
      name: row.table_name,
      columns: columnsByTable.get(row.table_name) || []
    }))
  };
}

function tableMap(catalog) {
  return new Map(catalog.tables.map((table) => [table.name, table]));
}

function countSqlForSpec(spec) {
  const t = quoteIdent(spec.tableName);
  if (spec.scope === "workspace") {
    return `SELECT COUNT(*)::text AS count FROM ${t} WHERE tenant_key = $1 AND workspace_key = $2`;
  }
  return `SELECT COUNT(*)::text AS count FROM ${t} WHERE tenant_key = $1`;
}

function paramsForSpec(spec, options) {
  return spec.scope === "workspace"
    ? [options.tenantKey, options.workspaceKey]
    : [options.tenantKey];
}

function readCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function countRows(client, spec, options) {
  const result = await client.query(countSqlForSpec(spec), paramsForSpec(spec, options));
  return readCount(result.rows[0]?.count);
}

function tableSpecs() {
  return [
    ...TENANT_TABLES.map((tableName) => ({ tableName, scope: "tenant" })),
    ...WORKSPACE_TABLES.map((tableName) => ({ tableName, scope: "workspace" }))
  ];
}

function validateTableSpec(spec, tables) {
  const table = tables.get(spec.tableName);
  if (!table) {
    return {
      key: `table.${spec.tableName}.missing`,
      tableName: spec.tableName,
      check: "missing_table",
      severity: "blocker",
      count: 1,
      description: `${spec.tableName} is expected in the offboarding surface but is missing from the database catalog.`
    };
  }
  if (!hasColumn(table, "tenant_key")) {
    return {
      key: `table.${spec.tableName}.missing_tenant_key`,
      tableName: spec.tableName,
      check: "missing_tenant_scope",
      severity: "blocker",
      count: 1,
      description: `${spec.tableName} is expected to be tenant-owned but has no tenant_key column.`
    };
  }
  if (spec.scope === "workspace" && !hasColumn(table, "workspace_key")) {
    return {
      key: `table.${spec.tableName}.missing_workspace_key`,
      tableName: spec.tableName,
      check: "missing_workspace_scope",
      severity: "blocker",
      count: 1,
      description: `${spec.tableName} is expected to be workspace-owned but has no workspace_key column.`
    };
  }
  return null;
}

async function buildTargetScopeChecks(client, options) {
  const [tenantResult, workspaceResult] = await Promise.all([
    client.query("SELECT COUNT(*)::text AS count FROM tenants WHERE tenant_key = $1", [options.tenantKey]),
    client.query(
      "SELECT COUNT(*)::text AS count FROM workspaces WHERE tenant_key = $1 AND workspace_key = $2",
      [options.tenantKey, options.workspaceKey]
    )
  ]);
  const tenantCount = readCount(tenantResult.rows[0]?.count);
  const workspaceCount = readCount(workspaceResult.rows[0]?.count);
  return [
    {
      key: "target.tenant_exists",
      check: "target_scope",
      severity: "blocker",
      count: tenantCount === 1 ? 0 : 1,
      description: "Target tenant must exist exactly once before offboarding can be rehearsed."
    },
    {
      key: "target.workspace_exists",
      check: "target_scope",
      severity: "blocker",
      count: workspaceCount === 1 ? 0 : 1,
      description: "Target workspace must exist exactly once before offboarding can be rehearsed."
    },
    {
      key: "target.not_primary_bridge",
      check: "primary_bridge",
      severity: "blocker",
      count: options.tenantKey === "primary" || options.workspaceKey === "primary" ? 1 : 0,
      description: "The legacy primary compatibility scope cannot be offboarded destructively."
    }
  ];
}

async function buildLegalHoldCheck(client, tables, options) {
  const table = tables.get("ai_knowledge_documents");
  if (!table || !hasColumn(table, "metadata")) {
    return {
      key: "legal_hold.knowledge_documents",
      check: "legal_hold",
      severity: "blocker",
      count: 1,
      description: "Legal-hold status cannot be proven because ai_knowledge_documents.metadata is missing."
    };
  }
  const result = await client.query(
    `SELECT COUNT(*)::text AS count
       FROM ai_knowledge_documents
      WHERE tenant_key = $1
        AND workspace_key = $2
        AND COALESCE(metadata #>> '{retention,legalHold}', 'false') = 'true'`,
    [options.tenantKey, options.workspaceKey]
  );
  const count = readCount(result.rows[0]?.count);
  return {
    key: "legal_hold.knowledge_documents",
    check: "legal_hold",
    severity: "blocker",
    count,
    description: "Knowledge documents under legal hold block tenant offboarding execution."
  };
}

async function buildObjectReferenceChecks(client, tables, options) {
  const checks = [];
  for (const ref of OBJECT_REF_COLUMNS) {
    const table = tables.get(ref.table);
    if (!table || !hasColumn(table, ref.column)) {
      continue;
    }
    const result = await client.query(
      `SELECT COUNT(*)::text AS count
         FROM ${quoteIdent(ref.table)}
        WHERE tenant_key = $1
          AND workspace_key = $2
          AND ${quoteIdent(ref.column)} IS NOT NULL
          AND btrim(${quoteIdent(ref.column)}) <> ''`,
      [options.tenantKey, options.workspaceKey]
    );
    checks.push({
      key: `object_refs.${ref.table}.${ref.column}`,
      tableName: ref.table,
      check: "object_reference",
      severity: "warning",
      count: readCount(result.rows[0]?.count),
      description: `${ref.table}.${ref.column} has R2 object references that require export/rehearsal and object-destruction handling.`
    });
  }
  return checks;
}

async function buildBetterAuthAdapterCheck(client, tables) {
  const table = tables.get("better_auth_users");
  if (!table) {
    return {
      key: "better_auth_adapter.global_tables",
      check: "global_auth_adapter",
      severity: "info",
      count: 0,
      description: "Better Auth adapter tables are not present in this database catalog."
    };
  }
  const result = await client.query("SELECT COUNT(*)::text AS count FROM better_auth_users");
  return {
    key: "better_auth_adapter.global_tables",
    check: "global_auth_adapter",
    severity: "warning",
    count: readCount(result.rows[0]?.count),
    description:
      "Better Auth adapter rows are global; tenant offboarding can only prove tenant-safe cleanup through auth_identity_accounts until the adapter is tenant-mapped."
  };
}

function physicalDeleteCheck(options) {
  return {
    key: "physical_delete.preview_only",
    check: "physical_delete",
    severity: "blocker",
    count: options.mode === "delete" ? 1 : 0,
    description:
      "Physical tenant delete remains blocked until backup/restore, R2 object deletion, and legal-hold drills are proven."
  };
}

function visibleChecks(checks, includePassed) {
  return includePassed ? checks : checks.filter((check) => check.count > 0);
}

async function runTenantOffboardingRehearsal(client, options) {
  const catalog = await loadCatalog(client);
  const tables = tableMap(catalog);
  const specs = tableSpecs();
  const tablePlans = [];
  const checks = [];

  checks.push(...(await buildTargetScopeChecks(client, options)));
  checks.push(physicalDeleteCheck(options));

  for (const spec of specs) {
    const validation = validateTableSpec(spec, tables);
    if (validation) {
      checks.push(validation);
      tablePlans.push({
        tableName: spec.tableName,
        scope: spec.scope,
        rowCount: 0,
        ready: false
      });
      continue;
    }
    const rowCount = await countRows(client, spec, options);
    tablePlans.push({
      tableName: spec.tableName,
      scope: spec.scope,
      rowCount,
      ready: true
    });
  }

  checks.push(await buildLegalHoldCheck(client, tables, options));
  checks.push(...(await buildObjectReferenceChecks(client, tables, options)));
  checks.push(await buildBetterAuthAdapterCheck(client, tables));

  const failedChecks = checks.filter((check) => check.count > 0);
  const blockerCount = failedChecks.filter((check) => check.severity === "blocker").length;
  const warningCount = failedChecks.filter((check) => check.severity === "warning").length;
  const infoCount = failedChecks.filter((check) => check.severity === "info").length;
  const objectReferenceRows = checks
    .filter((check) => check.check === "object_reference")
    .reduce((total, check) => total + check.count, 0);
  const totalRows = tablePlans.reduce((total, table) => total + table.rowCount, 0);

  return {
    formatVersion: FORMAT_VERSION,
    reportId: randomUUID(),
    generatedAt: new Date().toISOString(),
    tenantKey: options.tenantKey,
    workspaceKey: options.workspaceKey,
    mode: options.mode,
    ready: blockerCount === 0,
    writesDatabase: false,
    secretsRedacted: true,
    confirmationRequired: `${options.mode.toUpperCase()} ${options.tenantKey}/${options.workspaceKey}`,
    blockerCount,
    warningCount,
    infoCount,
    tableCount: tablePlans.length,
    totalRows,
    checks: visibleChecks(checks, options.includePassed),
    tables: tablePlans.filter((table) => options.includePassed || table.rowCount > 0 || !table.ready),
    summary: {
      tablesWithRows: tablePlans.filter((table) => table.rowCount > 0).length,
      objectReferenceRows,
      legalHoldKnowledgeDocuments:
        checks.find((check) => check.key === "legal_hold.knowledge_documents")?.count ?? 0,
      missingExpectedTables: checks.filter((check) => check.check === "missing_table").length,
      missingScopeColumns: checks.filter(
        (check) => check.check === "missing_tenant_scope" || check.check === "missing_workspace_scope"
      ).length,
      globalBetterAuthRows:
        checks.find((check) => check.key === "better_auth_adapter.global_tables")?.count ?? 0
    }
  };
}

function evidenceFileName(report) {
  return `tenant-offboarding-rehearsal-${report.generatedAt.replace(/[:.]/g, "-")}-${report.reportId}.json`;
}

function resolveEvidencePath(options, report) {
  if (options.output) return options.output;
  if (!options.evidenceDir) return null;
  return path.join(options.evidenceDir, evidenceFileName(report));
}

async function writeRehearsalEvidence(report, outputPath) {
  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolved;
}

function summaryText(report, outputPath = null) {
  const lines = [
    `Tenant offboarding rehearsal ${report.ready ? "passed" : "blocked"}`,
    `Report: ${report.reportId}`,
    `Scope: ${report.tenantKey}/${report.workspaceKey}`,
    `Mode: ${report.mode}`,
    `Writes database: ${report.writesDatabase}`,
    `Tables: ${report.tableCount}`,
    `Rows in scope: ${report.totalRows}`,
    `Blockers: ${report.blockerCount}`,
    `Warnings: ${report.warningCount}`,
    `Object references: ${report.summary.objectReferenceRows}`
  ];
  if (outputPath) lines.push(`Evidence: ${outputPath}`);
  return lines.join("\n");
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log(helpText());
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const report = await runTenantOffboardingRehearsal(client, options);
    const evidencePath = resolveEvidencePath(options, report);
    const writtenPath = evidencePath ? await writeRehearsalEvidence(report, evidencePath) : null;
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(summaryText(report, writtenPath));
    }
    if (!report.ready) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  FORMAT_VERSION,
  TENANT_TABLES,
  WORKSPACE_TABLES,
  parseArgs,
  runTenantOffboardingRehearsal,
  writeRehearsalEvidence,
  summaryText,
  helpText
};
