const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const PLAN_FORMAT_VERSION = "tenant-scope-backfill-plan.v1";
const BUNDLE_FORMAT_VERSION = "tenant-scope-backfill-bundle.v1";

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    plan: env.TENANT_BACKFILL_PLAN_PATH || "",
    bundleDir: env.TENANT_BACKFILL_BUNDLE_DIR || ".launch-evidence/tenant-backfill-bundles",
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
    if (name === "--plan") {
      options.plan = readValue();
      continue;
    }
    if (name === "--bundle-dir") {
      options.bundleDir = readValue();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.plan = String(options.plan || "").trim();
  options.bundleDir = String(options.bundleDir || "").trim();
  return options;
}

function helpText() {
  return [
    "Usage: node scripts/tenant-scope-backfill-bundle.js --plan=<plan.json> [options]",
    "       npm run bundle:tenant-backfill -- --plan=.launch-evidence/tenant-backfill/<plan>.json",
    "",
    "Generates reviewed apply/rollback SQL from a ready tenant backfill dry-run plan.",
    "The script writes files only; it does not connect to Postgres or execute SQL.",
    "",
    "Options:",
    "  --plan=path          Required dry-run plan JSON from npm run plan:tenant-backfill.",
    "  --bundle-dir=path    Output directory. Default: .launch-evidence/tenant-backfill-bundles."
  ].join("\n");
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function readCount(value) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function validatePlan(plan) {
  requireObject(plan, "plan");
  requireObject(plan.source, "plan.source");
  requireObject(plan.target, "plan.target");

  const errors = [];
  if (plan.formatVersion !== PLAN_FORMAT_VERSION) {
    errors.push(`plan formatVersion must be ${PLAN_FORMAT_VERSION}`);
  }
  if (plan.writesDatabase !== false) {
    errors.push("plan must be dry-run evidence with writesDatabase=false");
  }
  if (plan.readyToApply !== true) {
    errors.push("plan must be readyToApply=true before bundle generation");
  }
  if (Array.isArray(plan.readinessReasons) && plan.readinessReasons.length > 0) {
    errors.push(`plan still has readiness reasons: ${plan.readinessReasons.join("; ")}`);
  }
  if (!plan.source.tenantKey || !plan.source.workspaceKey) {
    errors.push("plan source tenant/workspace is required");
  }
  if (!plan.target.tenantKey || !plan.target.workspaceKey) {
    errors.push("plan target tenant/workspace is required");
  }
  if (
    plan.source.tenantKey &&
    plan.source.workspaceKey &&
    plan.target.tenantKey &&
    plan.target.workspaceKey &&
    plan.source.tenantKey === plan.target.tenantKey &&
    plan.source.workspaceKey === plan.target.workspaceKey
  ) {
    errors.push("plan source and target tenant/workspace must be different");
  }
  if (!Array.isArray(plan.tables)) {
    errors.push("plan tables must be an array");
  }

  for (const table of Array.isArray(plan.tables) ? plan.tables : []) {
    if (!table || typeof table !== "object") {
      errors.push("plan tables must contain objects");
      continue;
    }
    if (table.error) {
      errors.push(`${table.tableName || "unknown table"} has a dry-run query error`);
    }
    if (!table.rootTable && readCount(table.rowCount) > 0 && readCount(table.targetRowCount) > 0) {
      errors.push(`${table.tableName} already has target-scope rows; rollback would be ambiguous`);
    }
  }

  return errors;
}

function migrationTables(plan) {
  return plan.tables
    .filter((table) => !table.rootTable)
    .filter((table) => readCount(table.rowCount) > 0)
    .filter((table) => table.scopeType === "tenant" || table.scopeType === "workspace");
}

function rootTables(plan) {
  return plan.tables
    .filter((table) => table.rootTable && readCount(table.rowCount) > 0)
    .map((table) => ({
      tableName: table.tableName,
      rowCount: readCount(table.rowCount),
      operation: table.operation
    }));
}

function whereClause(table, scope) {
  const tenant = quoteLiteral(scope.tenantKey);
  if (table.scopeType === "workspace") {
    return `${quoteIdent("tenant_key")} = ${tenant} AND ${quoteIdent("workspace_key")} = ${quoteLiteral(scope.workspaceKey)}`;
  }
  return `${quoteIdent("tenant_key")} = ${tenant}`;
}

function assignmentClause(table, scope) {
  const assignments = [`${quoteIdent("tenant_key")} = ${quoteLiteral(scope.tenantKey)}`];
  if (table.scopeType === "workspace") {
    assignments.push(`${quoteIdent("workspace_key")} = ${quoteLiteral(scope.workspaceKey)}`);
  }
  return assignments.join(", ");
}

function tableCountExpression(table, scope) {
  return `(SELECT COUNT(*) FROM ${quoteIdent(table.tableName)} WHERE ${whereClause(table, scope)})`;
}

function raiseMessage(message) {
  return quoteLiteral(message);
}

function buildApplyBlock(table, plan) {
  const source = plan.source;
  const target = plan.target;
  const expected = readCount(table.rowCount);
  const sourceCount = tableCountExpression(table, source);
  const targetCount = tableCountExpression(table, target);

  return [
    `-- ${table.tableName}: move ${expected} ${table.scopeType}-scoped rows into ${target.tenantKey}/${target.workspaceKey}`,
    "DO $$",
    "DECLARE",
    "  moved_count integer;",
    "BEGIN",
    `  IF ${sourceCount} <> ${expected} THEN`,
    `    RAISE EXCEPTION ${raiseMessage(`tenant backfill apply precondition failed for ${table.tableName}: source row count changed`)};`,
    "  END IF;",
    `  IF ${targetCount} <> 0 THEN`,
    `    RAISE EXCEPTION ${raiseMessage(`tenant backfill apply precondition failed for ${table.tableName}: target scope is not empty`)};`,
    "  END IF;",
    `  UPDATE ${quoteIdent(table.tableName)}`,
    `     SET ${assignmentClause(table, target)}`,
    `   WHERE ${whereClause(table, source)};`,
    "  GET DIAGNOSTICS moved_count = ROW_COUNT;",
    `  IF moved_count <> ${expected} THEN`,
    `    RAISE EXCEPTION ${raiseMessage(`tenant backfill apply failed for ${table.tableName}: moved row count mismatch`)};`,
    "  END IF;",
    "END",
    "$$;",
    ""
  ].join("\n");
}

function buildRollbackBlock(table, plan) {
  const source = plan.source;
  const target = plan.target;
  const expected = readCount(table.rowCount);
  const sourceCount = tableCountExpression(table, source);
  const targetCount = tableCountExpression(table, target);

  return [
    `-- ${table.tableName}: move ${expected} ${table.scopeType}-scoped rows back to ${source.tenantKey}/${source.workspaceKey}`,
    "DO $$",
    "DECLARE",
    "  moved_count integer;",
    "BEGIN",
    `  IF ${sourceCount} <> 0 THEN`,
    `    RAISE EXCEPTION ${raiseMessage(`tenant backfill rollback precondition failed for ${table.tableName}: source scope is not empty`)};`,
    "  END IF;",
    `  IF ${targetCount} <> ${expected} THEN`,
    `    RAISE EXCEPTION ${raiseMessage(`tenant backfill rollback precondition failed for ${table.tableName}: target row count changed`)};`,
    "  END IF;",
    `  UPDATE ${quoteIdent(table.tableName)}`,
    `     SET ${assignmentClause(table, source)}`,
    `   WHERE ${whereClause(table, target)};`,
    "  GET DIAGNOSTICS moved_count = ROW_COUNT;",
    `  IF moved_count <> ${expected} THEN`,
    `    RAISE EXCEPTION ${raiseMessage(`tenant backfill rollback failed for ${table.tableName}: moved row count mismatch`)};`,
    "  END IF;",
    "END",
    "$$;",
    ""
  ].join("\n");
}

function sqlHeader({ kind, plan, bundleId, generatedAt }) {
  return [
    `-- 6esk tenant scope backfill ${kind}`,
    `-- Bundle: ${bundleId}`,
    `-- Generated: ${generatedAt}`,
    `-- Plan: ${plan.reportId}`,
    `-- Source: ${plan.source.tenantKey}/${plan.source.workspaceKey}`,
    `-- Target: ${plan.target.tenantKey}/${plan.target.workspaceKey}`,
    "--",
    "-- REVIEW REQUIRED BEFORE PRODUCTION EXECUTION.",
    "-- Run only during approved maintenance/read-only mode with a verified database backup.",
    "-- The script aborts when source/target row counts differ from the reviewed dry-run plan.",
    "",
    "BEGIN;",
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '10min';",
    `SELECT pg_advisory_xact_lock(hashtext(${quoteLiteral(`tenant_scope_backfill:${plan.reportId}`)}));`,
    ""
  ].join("\n");
}

function sqlFooter() {
  return ["COMMIT;", ""].join("\n");
}

function buildApplySql(plan, bundleId, generatedAt) {
  const tables = migrationTables(plan);
  return [
    sqlHeader({ kind: "apply", plan, bundleId, generatedAt }),
    ...tables.map((table) => buildApplyBlock(table, plan)),
    sqlFooter()
  ].join("\n");
}

function buildRollbackSql(plan, bundleId, generatedAt) {
  const tables = [...migrationTables(plan)].reverse();
  return [
    sqlHeader({ kind: "rollback", plan, bundleId, generatedAt }),
    "-- Rollback is only safe before new writes are accepted into the target scope.",
    "-- If any target row count has changed, this script aborts and manual recovery is required.",
    "",
    ...tables.map((table) => buildRollbackBlock(table, plan)),
    sqlFooter()
  ].join("\n");
}

function buildReadme(plan, bundleId) {
  return [
    `# Tenant Backfill Bundle ${bundleId}`,
    "",
    "This bundle was generated from a dry-run tenant backfill plan.",
    "",
    "Execution rules:",
    "- review `manifest.json`, `apply.sql`, and `rollback.sql` before production use",
    "- run only during approved maintenance/read-only mode",
    "- verify a database backup exists before `apply.sql`",
    "- run `audit:tenant-isolation -- --mode=external_launch` after apply or rollback",
    "- do not use `rollback.sql` after new writes have been accepted into the target scope",
    "",
    `Source: ${plan.source.tenantKey}/${plan.source.workspaceKey}`,
    `Target: ${plan.target.tenantKey}/${plan.target.workspaceKey}`
  ].join("\n");
}

function buildMigrationBundle(plan, options = {}) {
  const errors = validatePlan(plan);
  if (errors.length > 0) {
    throw new Error(`Cannot generate tenant backfill bundle: ${errors.join("; ")}`);
  }

  const generatedAt = options.generatedAt || new Date().toISOString();
  const bundleId = options.bundleId || randomUUID();
  const tables = migrationTables(plan);
  const rootManualTables = rootTables(plan);
  const manifest = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    bundleId,
    generatedAt,
    planReportId: plan.reportId,
    source: plan.source,
    target: plan.target,
    writesDatabase: false,
    executionMode: "reviewed_sql",
    migrationTableCount: tables.length,
    migrationRowCount: tables.reduce((sum, table) => sum + readCount(table.rowCount), 0),
    rootManualTables,
    files: {
      apply: "apply.sql",
      rollback: "rollback.sql",
      readme: "README.md"
    },
    preconditions: [
      "target tenant/workspace roots exist",
      "target child scope is empty for every migrated table",
      "application is in maintenance/read-only mode",
      "database backup and restore path have been verified",
      "post-apply tenant-isolation audit will be captured"
    ],
    rollbackLimits: [
      "rollback is valid only before new writes are accepted into the target scope",
      "rollback aborts if reviewed target/source row counts changed"
    ]
  };

  return {
    manifest,
    applySql: buildApplySql(plan, bundleId, generatedAt),
    rollbackSql: buildRollbackSql(plan, bundleId, generatedAt),
    readme: buildReadme(plan, bundleId)
  };
}

async function writeMigrationBundle(bundle, bundleDir) {
  const outputDir = path.resolve(bundleDir, bundle.manifest.bundleId);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(bundle.manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "apply.sql"), bundle.applySql, "utf8");
  await fs.writeFile(path.join(outputDir, "rollback.sql"), bundle.rollbackSql, "utf8");
  await fs.writeFile(path.join(outputDir, "README.md"), `${bundle.readme}\n`, "utf8");
  return outputDir;
}

async function readPlan(planPath) {
  const raw = await fs.readFile(planPath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log(helpText());
    return 0;
  }
  if (!options.plan) {
    throw new Error("--plan is required");
  }

  const plan = await readPlan(options.plan);
  const bundle = buildMigrationBundle(plan);
  const outputDir = await writeMigrationBundle(bundle, options.bundleDir);
  console.log(JSON.stringify({ bundleId: bundle.manifest.bundleId, outputDir }, null, 2));
  return 0;
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
  buildMigrationBundle,
  helpText,
  parseArgs,
  validatePlan,
  writeMigrationBundle
};
