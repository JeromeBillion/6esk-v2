const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { Client } = require("pg");

const FORMAT_VERSION = "tenant-scope-backfill-plan.v1";
const ROOT_TABLES = new Set(["tenants", "organizations", "workspaces"]);

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    sourceTenant: env.TENANT_BACKFILL_SOURCE_TENANT || "primary",
    sourceWorkspace: env.TENANT_BACKFILL_SOURCE_WORKSPACE || "primary",
    targetTenant: env.TENANT_BACKFILL_TARGET_TENANT || "",
    targetWorkspace: env.TENANT_BACKFILL_TARGET_WORKSPACE || "",
    sampleLimit: 10,
    includeEmpty: false,
    json: false,
    output: env.TENANT_BACKFILL_PLAN_OUTPUT || null,
    evidenceDir: env.TENANT_BACKFILL_PLAN_EVIDENCE_DIR || null,
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
    if (name === "--source-tenant") {
      options.sourceTenant = readValue();
      continue;
    }
    if (name === "--source-workspace") {
      options.sourceWorkspace = readValue();
      continue;
    }
    if (name === "--target-tenant") {
      options.targetTenant = readValue();
      continue;
    }
    if (name === "--target-workspace") {
      options.targetWorkspace = readValue();
      continue;
    }
    if (name === "--sample-limit") {
      options.sampleLimit = Number.parseInt(readValue(), 10);
      continue;
    }
    if (arg === "--include-empty") {
      options.includeEmpty = true;
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

  options.sourceTenant = String(options.sourceTenant || "").trim();
  options.sourceWorkspace = String(options.sourceWorkspace || "").trim();
  options.targetTenant = String(options.targetTenant || "").trim();
  options.targetWorkspace = String(options.targetWorkspace || "").trim();

  if (!Number.isFinite(options.sampleLimit) || options.sampleLimit < 1 || options.sampleLimit > 25) {
    throw new Error("--sample-limit must be an integer from 1 to 25");
  }
  options.sampleLimit = Math.trunc(options.sampleLimit);
  return options;
}

function helpText() {
  return [
    "Usage: node scripts/tenant-scope-backfill-plan.js --target-tenant=<key> --target-workspace=<key> [options]",
    "       npm run plan:tenant-backfill -- --target-tenant=<key> --target-workspace=<key>",
    "",
    "Builds a dry-run tenant/workspace backfill plan against DATABASE_URL.",
    "The script does not write database rows; it classifies source-scope rows and writes redacted evidence.",
    "",
    "Options:",
    "  --source-tenant=<key>       Source tenant key. Default: primary.",
    "  --source-workspace=<key>    Source workspace key. Default: primary.",
    "  --target-tenant=<key>       Required target tenant key.",
    "  --target-workspace=<key>    Required target workspace key.",
    "  --sample-limit=1..25        Sample ids per table. Default: 10.",
    "  --include-empty             Include zero-row scoped tables in the report.",
    "  --json                      Print JSON instead of human summary.",
    "  --output=path               Write the full JSON report to a file.",
    "  --evidence-dir=path         Write a timestamped JSON report under the directory."
  ].join("\n");
}

function validatePlanOptions(options) {
  const errors = [];
  if (!options.sourceTenant) errors.push("source tenant is required");
  if (!options.sourceWorkspace) errors.push("source workspace is required");
  if (!options.targetTenant) errors.push("target tenant is required");
  if (!options.targetWorkspace) errors.push("target workspace is required");
  if (
    options.sourceTenant &&
    options.sourceWorkspace &&
    options.targetTenant &&
    options.targetWorkspace &&
    options.sourceTenant === options.targetTenant &&
    options.sourceWorkspace === options.targetWorkspace
  ) {
    errors.push("source and target tenant/workspace must be different");
  }
  return errors;
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function tableName(table) {
  return quoteIdent(table.name);
}

function hasColumn(table, column) {
  return table.columns.includes(column);
}

function sampleExpression(table, alias = "") {
  const prefix = alias ? `${quoteIdent(alias)}.` : "";
  const q = (column) => `${prefix}${quoteIdent(column)}`;
  if (hasColumn(table, "id")) return `${q("id")}::text`;
  if (hasColumn(table, "tenant_key") && hasColumn(table, "workspace_key")) {
    return `${q("tenant_key")} || ':' || ${q("workspace_key")}`;
  }
  if (hasColumn(table, "tenant_key") && hasColumn(table, "organization_key")) {
    return `${q("tenant_key")} || ':' || ${q("organization_key")}`;
  }
  const columns = table.columns.slice(0, 2);
  if (columns.length === 0) return "NULL::text";
  return columns.map((column) => `${q(column)}::text`).join(" || ':' || ");
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

function operationForTable(table) {
  if (table.name === "tenants") return "manual_root_tenant";
  if (table.name === "organizations") return "manual_root_organization";
  if (table.name === "workspaces") return "manual_root_workspace";
  if (hasColumn(table, "workspace_key")) return "workspace_scope_reassignment";
  return "tenant_scope_reassignment";
}

function previewForTable(table) {
  const t = tableName(table);
  if (table.name === "tenants") {
    return "Create the target tenant before child-row reassignment; retire or isolate the source tenant only after external_launch audit passes.";
  }
  if (table.name === "organizations") {
    return "Create the target organization before workspace reassignment; avoid primary-key mutation while child references exist.";
  }
  if (table.name === "workspaces") {
    return "Create the target workspace before child-row reassignment; retire or isolate the source workspace only after verification.";
  }
  if (hasColumn(table, "workspace_key")) {
    return `UPDATE ${t} SET tenant_key = :targetTenant, workspace_key = :targetWorkspace WHERE tenant_key = :sourceTenant AND workspace_key = :sourceWorkspace;`;
  }
  return `UPDATE ${t} SET tenant_key = :targetTenant WHERE tenant_key = :sourceTenant;`;
}

function buildBackfillDefinitions(catalog) {
  return catalog.tables
    .filter((table) => hasColumn(table, "tenant_key"))
    .map((table) => {
      const workspaceScoped = hasColumn(table, "workspace_key");
      const whereSql = workspaceScoped
        ? `WHERE ${quoteIdent("tenant_key")} = $1 AND ${quoteIdent("workspace_key")} = $2`
        : `WHERE ${quoteIdent("tenant_key")} = $1`;
      const limitParam = workspaceScoped ? "$3" : "$2";
      return {
        tableName: table.name,
        scopeType: workspaceScoped ? "workspace" : "tenant",
        operation: operationForTable(table),
        rootTable: ROOT_TABLES.has(table.name),
        countSql: `SELECT COUNT(*)::text AS count FROM ${tableName(table)} ${whereSql}`,
        targetCountSql: `SELECT COUNT(*)::text AS count FROM ${tableName(table)} ${whereSql}`,
        sampleSql: `SELECT ${sampleExpression(table)} AS sample_id FROM ${tableName(table)} ${whereSql} ORDER BY sample_id LIMIT ${limitParam}`,
        updatePreview: previewForTable(table)
      };
    });
}

function readCount(value) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readError(error) {
  return error instanceof Error ? error.message : "Unknown query failure";
}

async function queryCount(client, sql, params) {
  const result = await client.query(sql, params);
  return readCount(result.rows[0] && result.rows[0].count);
}

async function queryExistence(client, table, whereSql, params) {
  const result = await client.query(`SELECT COUNT(*)::text AS count FROM ${quoteIdent(table)} ${whereSql}`, params);
  return readCount(result.rows[0] && result.rows[0].count) > 0;
}

async function readScopeState(client, catalog, options) {
  const tableNames = new Set(catalog.tables.map((table) => table.name));
  const state = {
    sourceTenantExists: null,
    sourceWorkspaceExists: null,
    targetTenantExists: null,
    targetWorkspaceExists: null
  };

  if (tableNames.has("tenants")) {
    state.sourceTenantExists = await queryExistence(client, "tenants", "WHERE tenant_key = $1", [
      options.sourceTenant
    ]);
    state.targetTenantExists = await queryExistence(client, "tenants", "WHERE tenant_key = $1", [
      options.targetTenant
    ]);
  }
  if (tableNames.has("workspaces")) {
    state.sourceWorkspaceExists = await queryExistence(
      client,
      "workspaces",
      "WHERE tenant_key = $1 AND workspace_key = $2",
      [options.sourceTenant, options.sourceWorkspace]
    );
    state.targetWorkspaceExists = await queryExistence(
      client,
      "workspaces",
      "WHERE tenant_key = $1 AND workspace_key = $2",
      [options.targetTenant, options.targetWorkspace]
    );
  }

  return state;
}

async function runBackfillDefinition(client, definition, options) {
  const params = [options.sourceTenant];
  const targetParams = [options.targetTenant];
  if (definition.scopeType === "workspace") {
    params.push(options.sourceWorkspace);
    targetParams.push(options.targetWorkspace);
  }

  try {
    const count = await queryCount(client, definition.countSql, params);
    const targetCount = await queryCount(client, definition.targetCountSql, targetParams);
    const sampleParams =
      definition.scopeType === "workspace"
        ? [options.sourceTenant, options.sourceWorkspace, options.sampleLimit]
        : [options.sourceTenant, options.sampleLimit];
    const sampleResult =
      count > 0
        ? await client.query(definition.sampleSql, sampleParams)
        : { rows: [] };

    return {
      tableName: definition.tableName,
      scopeType: definition.scopeType,
      operation: definition.operation,
      rootTable: definition.rootTable,
      rowCount: count,
      targetRowCount: targetCount,
      sampleIds: sampleResult.rows.map((row) => String(row.sample_id || "")).filter(Boolean),
      updatePreview: definition.updatePreview
    };
  } catch (error) {
    return {
      tableName: definition.tableName,
      scopeType: definition.scopeType,
      operation: definition.operation,
      rootTable: definition.rootTable,
      rowCount: 1,
      targetRowCount: 0,
      sampleIds: [],
      updatePreview: definition.updatePreview,
      error: readError(error)
    };
  }
}

function summarizeTables(tables) {
  const impacted = tables.filter((table) => table.rowCount > 0);
  const targetConflicts = tables.filter((table) => !table.rootTable && table.rowCount > 0 && table.targetRowCount > 0);
  return {
    scopedTableCount: tables.length,
    impactedTableCount: impacted.length,
    impactedRowCount: impacted.reduce((sum, table) => sum + table.rowCount, 0),
    rootTableRowCount: impacted.filter((table) => table.rootTable).reduce((sum, table) => sum + table.rowCount, 0),
    tenantScopedRowCount: impacted
      .filter((table) => table.scopeType === "tenant")
      .reduce((sum, table) => sum + table.rowCount, 0),
    workspaceScopedRowCount: impacted
      .filter((table) => table.scopeType === "workspace")
      .reduce((sum, table) => sum + table.rowCount, 0),
    targetConflictTableCount: targetConflicts.length,
    targetConflictRowCount: targetConflicts.reduce((sum, table) => sum + table.targetRowCount, 0),
    errorTableCount: tables.filter((table) => table.error).length
  };
}

function readinessReasons(validationErrors, scopeState, summary) {
  const reasons = [...validationErrors];
  if (scopeState.targetTenantExists === false) {
    reasons.push("target tenant does not exist");
  }
  if (scopeState.targetWorkspaceExists === false) {
    reasons.push("target workspace does not exist");
  }
  if (summary.impactedRowCount > 0 && scopeState.sourceTenantExists === false) {
    reasons.push("source tenant does not exist but source rows were found");
  }
  if (summary.workspaceScopedRowCount > 0 && scopeState.sourceWorkspaceExists === false) {
    reasons.push("source workspace does not exist but workspace-scoped source rows were found");
  }
  if (summary.errorTableCount > 0) {
    reasons.push("one or more table classification queries failed");
  }
  if (summary.targetConflictTableCount > 0) {
    reasons.push("target scope already contains child rows; reversible bundle generation requires an empty target child scope");
  }
  return reasons;
}

async function runTenantScopeBackfillPlan(client, options = {}) {
  const normalized = {
    sourceTenant: options.sourceTenant || "primary",
    sourceWorkspace: options.sourceWorkspace || "primary",
    targetTenant: options.targetTenant || "",
    targetWorkspace: options.targetWorkspace || "",
    sampleLimit: options.sampleLimit || 10,
    includeEmpty: Boolean(options.includeEmpty)
  };
  const validationErrors = validatePlanOptions(normalized);
  const generatedAt = new Date().toISOString();

  if (validationErrors.length > 0) {
    return {
      formatVersion: FORMAT_VERSION,
      reportId: randomUUID(),
      generatedAt,
      mode: "dry_run",
      readyToApply: false,
      source: {
        tenantKey: normalized.sourceTenant,
        workspaceKey: normalized.sourceWorkspace
      },
      target: {
        tenantKey: normalized.targetTenant,
        workspaceKey: normalized.targetWorkspace
      },
      scopeState: {
        sourceTenantExists: null,
        sourceWorkspaceExists: null,
        targetTenantExists: null,
        targetWorkspaceExists: null
      },
      sampleLimit: normalized.sampleLimit,
      summary: {
        scopedTableCount: 0,
        impactedTableCount: 0,
        impactedRowCount: 0,
        rootTableRowCount: 0,
        tenantScopedRowCount: 0,
        workspaceScopedRowCount: 0,
        targetConflictTableCount: 0,
        targetConflictRowCount: 0,
        errorTableCount: 0
      },
      readinessReasons: validationErrors,
      tables: [],
      writesDatabase: false
    };
  }

  const catalog = await loadCatalog(client);
  const scopeState = await readScopeState(client, catalog, normalized);
  const definitions = buildBackfillDefinitions(catalog);
  const allTables = [];

  for (const definition of definitions) {
    allTables.push(await runBackfillDefinition(client, definition, normalized));
  }

  const visibleTables = normalized.includeEmpty ? allTables : allTables.filter((table) => table.rowCount > 0);
  const summary = summarizeTables(allTables);
  const reasons = readinessReasons(validationErrors, scopeState, summary);

  return {
    formatVersion: FORMAT_VERSION,
    reportId: randomUUID(),
    generatedAt,
    mode: "dry_run",
    readyToApply: reasons.length === 0,
    source: {
      tenantKey: normalized.sourceTenant,
      workspaceKey: normalized.sourceWorkspace
    },
    target: {
      tenantKey: normalized.targetTenant,
      workspaceKey: normalized.targetWorkspace
    },
    scopeState,
    sampleLimit: normalized.sampleLimit,
    summary,
    readinessReasons: reasons,
    tables: visibleTables,
    writesDatabase: false
  };
}

function evidenceFileName(date = new Date()) {
  return `tenant-scope-backfill-plan-${date.toISOString().replace(/[:.]/g, "-")}.json`;
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

async function writePlanReport(report, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printSummary(report, outputPath = null) {
  console.log(`Tenant scope backfill plan ${report.reportId}`);
  console.log(`Mode: ${report.mode}`);
  console.log(`Source: ${report.source.tenantKey}/${report.source.workspaceKey}`);
  console.log(`Target: ${report.target.tenantKey}/${report.target.workspaceKey}`);
  console.log(`Ready to apply after review: ${report.readyToApply ? "yes" : "no"}`);
  console.log(
    `Rows: ${report.summary.impactedRowCount} across ${report.summary.impactedTableCount} impacted tables`
  );
  console.log(
    `Scope: ${report.summary.tenantScopedRowCount} tenant rows, ${report.summary.workspaceScopedRowCount} workspace rows, ${report.summary.rootTableRowCount} root rows`
  );
  if (report.summary.targetConflictTableCount > 0) {
    console.log(
      `Target conflicts: ${report.summary.targetConflictRowCount} existing rows across ${report.summary.targetConflictTableCount} child tables`
    );
  }
  if (report.readinessReasons.length > 0) {
    console.log("");
    for (const reason of report.readinessReasons) {
      console.log(`- ${reason}`);
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
    throw new Error("DATABASE_URL is required to build a tenant backfill plan");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const report = await runTenantScopeBackfillPlan(client, options);
    const outputPath = resolveOutputPath(options);
    if (outputPath) {
      await writePlanReport(report, outputPath);
    }
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printSummary(report, outputPath);
    }
    return report.readyToApply ? 0 : 1;
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
  buildBackfillDefinitions,
  helpText,
  parseArgs,
  runTenantScopeBackfillPlan,
  writePlanReport
};
