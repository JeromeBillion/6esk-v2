const fs = require("fs/promises");
const { randomUUID } = require("crypto");
const { Client } = require("pg");

const FORMAT_VERSION = "tenant-isolation-audit.v1";
const CHECK_KINDS = [
  "missing_scope",
  "orphan_tenant",
  "orphan_workspace",
  "orphan_parent",
  "cross_tenant_reference",
  "primary_bridge",
  "unscoped_identity"
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    mode: "standard",
    sampleLimit: 10,
    includePassed: false,
    json: false,
    output: null,
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
    if (name === "--mode") {
      options.mode = readValue();
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!["standard", "external_launch"].includes(options.mode)) {
    throw new Error("--mode must be standard or external_launch");
  }
  if (!Number.isFinite(options.sampleLimit) || options.sampleLimit < 1 || options.sampleLimit > 25) {
    throw new Error("--sample-limit must be an integer from 1 to 25");
  }
  options.sampleLimit = Math.trunc(options.sampleLimit);
  return options;
}

function helpText() {
  return [
    "Usage: node scripts/tenant-isolation-audit.js [options]",
    "       npm run audit:tenant-isolation -- -- [options]",
    "",
    "Runs a direct Postgres tenant-isolation audit against DATABASE_URL.",
    "",
    "Options:",
    "  --mode=standard|external_launch   Treat legacy primary bridge as warning or blocker.",
    "  --sample-limit=1..25               Sample ids per failing check. Default: 10.",
    "  --include-passed                   Include zero-count checks in the report.",
    "  --json                             Print JSON instead of human summary.",
    "  --output=path                      Write the full JSON report to a file."
  ].join("\n");
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function qualified(alias, column) {
  return `${quoteIdent(alias)}.${quoteIdent(column)}`;
}

function tableName(table) {
  return quoteIdent(table.name);
}

function hasColumn(table, column) {
  return table.columns.includes(column);
}

function primaryBridgeSeverity(mode) {
  return mode === "external_launch" ? "blocker" : "warning";
}

function sampleExpression(table, alias) {
  const q = (column) => (alias ? qualified(alias, column) : quoteIdent(column));
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

function tenantPresenceWhere(alias) {
  const tenant = alias ? qualified(alias, "tenant_key") : quoteIdent("tenant_key");
  return `(${tenant} IS NULL OR btrim(${tenant}) = '')`;
}

function scopedPresenceWhere(alias) {
  const tenant = alias ? qualified(alias, "tenant_key") : quoteIdent("tenant_key");
  const workspace = alias ? qualified(alias, "workspace_key") : quoteIdent("workspace_key");
  return `(${tenant} IS NULL OR btrim(${tenant}) = '' OR ${workspace} IS NULL OR btrim(${workspace}) = '')`;
}

function buildCatalogMaps(catalog) {
  const tables = new Map(catalog.tables.map((table) => [table.name, table]));
  return { tables };
}

function buildTenantDefinitions(table, mode) {
  const t = tableName(table);
  return [
    {
      key: `${table.name}.missing_tenant_scope`,
      tableName: table.name,
      check: "missing_scope",
      severity: "blocker",
      countSql: `SELECT COUNT(*)::text AS count FROM ${t} WHERE ${tenantPresenceWhere()}`,
      sampleSql:
        `SELECT ${sampleExpression(table)} AS sample_id FROM ${t} WHERE ${tenantPresenceWhere()} ORDER BY sample_id LIMIT $1`,
      description: `${table.name} has rows without a tenant key.`
    },
    {
      key: `${table.name}.orphan_tenant`,
      tableName: table.name,
      check: "orphan_tenant",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${t} "c"
         LEFT JOIN "tenants" "tenant" ON "tenant"."tenant_key" = "c"."tenant_key"
         WHERE NOT ${tenantPresenceWhere("c")}
           AND "tenant"."tenant_key" IS NULL`,
      sampleSql:
        `SELECT ${sampleExpression(table, "c")} AS sample_id
         FROM ${t} "c"
         LEFT JOIN "tenants" "tenant" ON "tenant"."tenant_key" = "c"."tenant_key"
         WHERE NOT ${tenantPresenceWhere("c")}
           AND "tenant"."tenant_key" IS NULL
         ORDER BY sample_id
         LIMIT $1`,
      description: `${table.name} references a tenant that does not exist.`
    },
    {
      key: `${table.name}.primary_bridge`,
      tableName: table.name,
      check: "primary_bridge",
      severity: primaryBridgeSeverity(mode),
      countSql: `SELECT COUNT(*)::text AS count FROM ${t} WHERE ${quoteIdent("tenant_key")} = 'primary'`,
      sampleSql:
        `SELECT ${sampleExpression(table)} AS sample_id FROM ${t} WHERE ${quoteIdent("tenant_key")} = 'primary' ORDER BY sample_id LIMIT $1`,
      description: `${table.name} still contains legacy primary tenant rows.`
    }
  ];
}

function buildWorkspaceDefinitions(table, mode) {
  const t = tableName(table);
  return [
    {
      key: `${table.name}.missing_scope`,
      tableName: table.name,
      check: "missing_scope",
      severity: "blocker",
      countSql: `SELECT COUNT(*)::text AS count FROM ${t} WHERE ${scopedPresenceWhere()}`,
      sampleSql:
        `SELECT ${sampleExpression(table)} AS sample_id FROM ${t} WHERE ${scopedPresenceWhere()} ORDER BY sample_id LIMIT $1`,
      description: `${table.name} has rows without a complete tenant/workspace key.`
    },
    {
      key: `${table.name}.orphan_workspace`,
      tableName: table.name,
      check: "orphan_workspace",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${t} "c"
         LEFT JOIN "workspaces" "workspace"
           ON "workspace"."tenant_key" = "c"."tenant_key"
          AND "workspace"."workspace_key" = "c"."workspace_key"
         WHERE NOT ${scopedPresenceWhere("c")}
           AND "workspace"."workspace_key" IS NULL`,
      sampleSql:
        `SELECT ${sampleExpression(table, "c")} AS sample_id
         FROM ${t} "c"
         LEFT JOIN "workspaces" "workspace"
           ON "workspace"."tenant_key" = "c"."tenant_key"
          AND "workspace"."workspace_key" = "c"."workspace_key"
         WHERE NOT ${scopedPresenceWhere("c")}
           AND "workspace"."workspace_key" IS NULL
         ORDER BY sample_id
         LIMIT $1`,
      description: `${table.name} references a workspace that does not exist inside its tenant.`
    },
    {
      key: `${table.name}.primary_bridge`,
      tableName: table.name,
      check: "primary_bridge",
      severity: primaryBridgeSeverity(mode),
      countSql:
        `SELECT COUNT(*)::text AS count FROM ${t}
         WHERE ${quoteIdent("tenant_key")} = 'primary' OR ${quoteIdent("workspace_key")} = 'primary'`,
      sampleSql:
        `SELECT ${sampleExpression(table)} AS sample_id FROM ${t}
         WHERE ${quoteIdent("tenant_key")} = 'primary' OR ${quoteIdent("workspace_key")} = 'primary'
         ORDER BY sample_id
         LIMIT $1`,
      description: `${table.name} still contains legacy primary tenant/workspace rows.`
    }
  ];
}

function buildWorkspacesDefinitions(table, mode) {
  const t = tableName(table);
  return [
    ...buildWorkspaceDefinitions(table, mode).filter((definition) => definition.check !== "orphan_workspace"),
    {
      key: "workspaces.orphan_tenant",
      tableName: "workspaces",
      check: "orphan_tenant",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${t} "c"
         LEFT JOIN "tenants" "tenant" ON "tenant"."tenant_key" = "c"."tenant_key"
         WHERE NOT ${scopedPresenceWhere("c")}
           AND "tenant"."tenant_key" IS NULL`,
      sampleSql:
        `SELECT ${sampleExpression(table, "c")} AS sample_id
         FROM ${t} "c"
         LEFT JOIN "tenants" "tenant" ON "tenant"."tenant_key" = "c"."tenant_key"
         WHERE NOT ${scopedPresenceWhere("c")}
           AND "tenant"."tenant_key" IS NULL
         ORDER BY sample_id
         LIMIT $1`,
      description: "workspaces references a tenant that does not exist."
    }
  ];
}

function buildForeignKeyDefinitions(foreignKey, tables, mode) {
  const child = tables.get(foreignKey.childTable);
  const parent = tables.get(foreignKey.parentTable);
  if (!child || !parent) return [];

  const childTable = tableName(child);
  const parentTable = tableName(parent);
  const joinConditions = foreignKey.childColumns.map((childColumn, index) => {
    const parentColumn = foreignKey.parentColumns[index];
    return `${qualified("p", parentColumn)} = ${qualified("c", childColumn)}`;
  });
  const presentWhere = foreignKey.childColumns
    .map((column) => `${qualified("c", column)} IS NOT NULL`)
    .join(" AND ");
  const parentNullColumn = foreignKey.parentColumns[0];
  const sample = sampleExpression(child, "c");
  const definitions = [
    {
      key: `${foreignKey.childTable}.${foreignKey.childColumns.join("_")}.orphan_parent`,
      tableName: foreignKey.childTable,
      check: "orphan_parent",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${childTable} "c"
         LEFT JOIN ${parentTable} "p" ON ${joinConditions.join(" AND ")}
         WHERE ${presentWhere}
           AND ${qualified("p", parentNullColumn)} IS NULL`,
      sampleSql:
        `SELECT ${sample} AS sample_id
         FROM ${childTable} "c"
         LEFT JOIN ${parentTable} "p" ON ${joinConditions.join(" AND ")}
         WHERE ${presentWhere}
           AND ${qualified("p", parentNullColumn)} IS NULL
         ORDER BY sample_id
         LIMIT $1`,
      description: `${foreignKey.childTable}.${foreignKey.childColumns.join(",")} references a missing ${foreignKey.parentTable} row.`
    }
  ];

  const childHasTenant = hasColumn(child, "tenant_key");
  const parentHasTenant = hasColumn(parent, "tenant_key");
  const childHasWorkspace = hasColumn(child, "workspace_key");
  const parentHasWorkspace = hasColumn(parent, "workspace_key");

  if (childHasTenant && parentHasTenant) {
    const scopeMismatch = childHasWorkspace && parentHasWorkspace
      ? `(${qualified("c", "tenant_key")} <> ${qualified("p", "tenant_key")} OR ${qualified("c", "workspace_key")} <> ${qualified("p", "workspace_key")})`
      : `${qualified("c", "tenant_key")} <> ${qualified("p", "tenant_key")}`;
    definitions.push({
      key: `${foreignKey.childTable}.${foreignKey.childColumns.join("_")}.cross_tenant_reference`,
      tableName: foreignKey.childTable,
      check: "cross_tenant_reference",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${childTable} "c"
         JOIN ${parentTable} "p" ON ${joinConditions.join(" AND ")}
         WHERE ${presentWhere}
           AND ${scopeMismatch}`,
      sampleSql:
        `SELECT ${sample} AS sample_id
         FROM ${childTable} "c"
         JOIN ${parentTable} "p" ON ${joinConditions.join(" AND ")}
         WHERE ${presentWhere}
           AND ${scopeMismatch}
         ORDER BY sample_id
         LIMIT $1`,
      description: `${foreignKey.childTable}.${foreignKey.childColumns.join(",")} points at a ${foreignKey.parentTable} row in another tenant/workspace scope.`
    });
  } else if (!childHasTenant && parentHasTenant) {
    definitions.push({
      key: `${foreignKey.childTable}.${foreignKey.childColumns.join("_")}.primary_bridge_parent`,
      tableName: foreignKey.childTable,
      check: "primary_bridge",
      severity: primaryBridgeSeverity(mode),
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${childTable} "c"
         JOIN ${parentTable} "p" ON ${joinConditions.join(" AND ")}
         WHERE ${presentWhere}
           AND ${qualified("p", "tenant_key")} = 'primary'`,
      sampleSql:
        `SELECT ${sample} AS sample_id
         FROM ${childTable} "c"
         JOIN ${parentTable} "p" ON ${joinConditions.join(" AND ")}
         WHERE ${presentWhere}
           AND ${qualified("p", "tenant_key")} = 'primary'
         ORDER BY sample_id
         LIMIT $1`,
      description: `${foreignKey.childTable}.${foreignKey.childColumns.join(",")} is owned through a legacy primary tenant parent row.`
    });
  }

  return definitions;
}

function buildExplicitDefinitions(catalog, mode) {
  const { tables } = buildCatalogMaps(catalog);
  const definitions = [];
  const tenants = tables.get("tenants");

  if (tenants) {
    definitions.push({
      key: "tenants.primary_bridge",
      tableName: "tenants",
      check: "primary_bridge",
      severity: primaryBridgeSeverity(mode),
      countSql: "SELECT COUNT(*)::text AS count FROM \"tenants\" WHERE \"tenant_key\" = 'primary'",
      sampleSql:
        "SELECT \"tenant_key\" AS sample_id FROM \"tenants\" WHERE \"tenant_key\" = 'primary' ORDER BY sample_id LIMIT $1",
      description:
        "The legacy primary tenant compatibility bridge still exists; this must be cleared or formally isolated before external launch."
    });
  }

  if (tables.get("voice_consent_events") && hasColumn(tables.get("voice_consent_events"), "customer_id")) {
    definitions.push({
      key: "voice_consent_events.unscoped_identity_without_customer",
      tableName: "voice_consent_events",
      check: "unscoped_identity",
      severity: "blocker",
      countSql:
        "SELECT COUNT(*)::text AS count FROM \"voice_consent_events\" WHERE \"customer_id\" IS NULL",
      sampleSql:
        "SELECT \"id\"::text AS sample_id FROM \"voice_consent_events\" WHERE \"customer_id\" IS NULL ORDER BY sample_id LIMIT $1",
      description:
        "voice_consent_events rows without customer_id cannot be deterministically attributed to a tenant."
    });
  }

  if (tables.get("call_review_writebacks") && tables.get("tickets") && tables.get("call_sessions")) {
    definitions.push({
      key: "call_review_writebacks.ticket_session_cross_tenant",
      tableName: "call_review_writebacks",
      check: "cross_tenant_reference",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM "call_review_writebacks" "c"
         JOIN "tickets" "t" ON "t"."id" = "c"."ticket_id"
         JOIN "call_sessions" "s" ON "s"."id" = "c"."call_session_id"
         WHERE "t"."tenant_key" <> "s"."tenant_key"
            OR "t"."workspace_key" <> "s"."workspace_key"`,
      sampleSql:
        `SELECT "c"."id"::text AS sample_id
         FROM "call_review_writebacks" "c"
         JOIN "tickets" "t" ON "t"."id" = "c"."ticket_id"
         JOIN "call_sessions" "s" ON "s"."id" = "c"."call_session_id"
         WHERE "t"."tenant_key" <> "s"."tenant_key"
            OR "t"."workspace_key" <> "s"."workspace_key"
         ORDER BY sample_id
         LIMIT $1`,
      description: "call_review_writebacks links tickets and call sessions from different tenant/workspace scopes."
    });
  }

  return definitions;
}

function buildAuditDefinitions(catalog, options = {}) {
  const mode = options.mode || "standard";
  const { tables } = buildCatalogMaps(catalog);
  const definitions = buildExplicitDefinitions(catalog, mode);

  for (const table of catalog.tables) {
    if (table.name === "tenants") continue;
    const tenantScoped = hasColumn(table, "tenant_key");
    const workspaceScoped = tenantScoped && hasColumn(table, "workspace_key");

    if (table.name === "workspaces" && workspaceScoped) {
      definitions.push(...buildWorkspacesDefinitions(table, mode));
      continue;
    }
    if (workspaceScoped) {
      definitions.push(...buildWorkspaceDefinitions(table, mode));
      continue;
    }
    if (tenantScoped) {
      definitions.push(...buildTenantDefinitions(table, mode));
    }
  }

  for (const foreignKey of catalog.foreignKeys) {
    definitions.push(...buildForeignKeyDefinitions(foreignKey, tables, mode));
  }

  return definitions;
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

  const foreignKeyResult = await client.query(
    `SELECT
       con.conname AS constraint_name,
       child.relname AS child_table,
       parent.relname AS parent_table,
       array_agg(child_att.attname ORDER BY child_cols.ordinality) AS child_columns,
       array_agg(parent_att.attname ORDER BY parent_cols.ordinality) AS parent_columns
     FROM pg_constraint con
     JOIN pg_class child ON child.oid = con.conrelid
     JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
     JOIN pg_class parent ON parent.oid = con.confrelid
     JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
     JOIN unnest(con.conkey) WITH ORDINALITY AS child_cols(attnum, ordinality) ON true
     JOIN unnest(con.confkey) WITH ORDINALITY AS parent_cols(attnum, ordinality)
       ON parent_cols.ordinality = child_cols.ordinality
     JOIN pg_attribute child_att
       ON child_att.attrelid = child.oid
      AND child_att.attnum = child_cols.attnum
     JOIN pg_attribute parent_att
       ON parent_att.attrelid = parent.oid
      AND parent_att.attnum = parent_cols.attnum
     WHERE con.contype = 'f'
       AND child_ns.nspname = 'public'
       AND parent_ns.nspname = 'public'
     GROUP BY con.conname, child.relname, parent.relname
     ORDER BY child.relname, con.conname`
  );

  return {
    tables: tableResult.rows.map((row) => ({
      name: row.table_name,
      columns: columnsByTable.get(row.table_name) || []
    })),
    foreignKeys: foreignKeyResult.rows.map((row) => ({
      constraintName: row.constraint_name,
      childTable: row.child_table,
      parentTable: row.parent_table,
      childColumns: row.child_columns,
      parentColumns: row.parent_columns
    }))
  };
}

function readCount(value) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readError(error) {
  return error instanceof Error ? error.message : "Unknown audit query failure";
}

async function runDefinition(client, definition, sampleLimit) {
  try {
    const countResult = await client.query(definition.countSql);
    const count = readCount(countResult.rows[0] && countResult.rows[0].count);
    const sampleResult =
      count > 0
        ? await client.query(definition.sampleSql, [sampleLimit])
        : { rows: [] };
    return {
      key: definition.key,
      tableName: definition.tableName,
      check: definition.check,
      severity: definition.severity,
      count,
      sampleIds: sampleResult.rows.map((row) => String(row.sample_id || "")).filter(Boolean),
      description: definition.description
    };
  } catch (error) {
    return {
      key: definition.key,
      tableName: definition.tableName,
      check: definition.check,
      severity: "blocker",
      count: 1,
      sampleIds: [],
      description: `${definition.description} The audit query failed, so launch readiness cannot be proven.`,
      error: readError(error)
    };
  }
}

function summarize(checks) {
  const summary = Object.fromEntries(CHECK_KINDS.map((kind) => [`${kind}Rows`, 0]));
  for (const check of checks) {
    summary[`${check.check}Rows`] += check.count;
  }
  return {
    missingScopeRows: summary.missing_scopeRows,
    orphanTenantRows: summary.orphan_tenantRows,
    orphanWorkspaceRows: summary.orphan_workspaceRows,
    orphanParentRows: summary.orphan_parentRows,
    crossTenantReferenceRows: summary.cross_tenant_referenceRows,
    primaryBridgeRows: summary.primary_bridgeRows,
    unscopedIdentityRows: summary.unscoped_identityRows
  };
}

async function runTenantIsolationAudit(client, options = {}) {
  const mode = options.mode || "standard";
  const sampleLimit = options.sampleLimit || 10;
  const catalog = await loadCatalog(client);
  const definitions = buildAuditDefinitions(catalog, { mode });
  const allChecks = [];

  for (const definition of definitions) {
    allChecks.push(await runDefinition(client, definition, sampleLimit));
  }

  const failedChecks = allChecks.filter((check) => check.count > 0);
  const blockerCount = failedChecks.filter((check) => check.severity === "blocker").length;
  const warningCount = failedChecks.filter((check) => check.severity === "warning").length;
  const infoCount = failedChecks.filter((check) => check.severity === "info").length;

  return {
    formatVersion: FORMAT_VERSION,
    reportId: randomUUID(),
    generatedAt: new Date().toISOString(),
    mode,
    ready: blockerCount === 0,
    blockerCount,
    warningCount,
    infoCount,
    evaluatedCheckCount: allChecks.length,
    failedCheckCount: failedChecks.length,
    passedCheckCount: allChecks.length - failedChecks.length,
    sampleLimit,
    checks: options.includePassed ? allChecks : failedChecks,
    summary: summarize(failedChecks)
  };
}

function printSummary(report) {
  console.log(`Tenant isolation audit ${report.reportId}`);
  console.log(`Mode: ${report.mode}`);
  console.log(`Ready: ${report.ready ? "yes" : "no"}`);
  console.log(
    `Checks: ${report.evaluatedCheckCount} evaluated, ${report.failedCheckCount} failed, ${report.blockerCount} blockers, ${report.warningCount} warnings`
  );

  if (report.checks.length > 0) {
    console.log("");
    for (const check of report.checks) {
      const samples = check.sampleIds.length > 0 ? ` samples=${check.sampleIds.join(",")}` : "";
      const error = check.error ? ` error=${check.error}` : "";
      console.log(`[${check.severity}] ${check.key}: count=${check.count}${samples}${error}`);
    }
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
    throw new Error("DATABASE_URL is required to run tenant isolation audit");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const report = await runTenantIsolationAudit(client, options);
    if (options.output) {
      await fs.writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printSummary(report);
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
  buildAuditDefinitions,
  helpText,
  parseArgs,
  runTenantIsolationAudit
};
