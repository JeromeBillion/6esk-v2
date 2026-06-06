const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const FORMAT_VERSION = "tenant-query-scope-sweep.v1";

const DEFAULT_ROOTS = ["src/app/api", "src/server", "scripts"];
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".launch-evidence",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules"
]);
const IGNORED_FILES = new Set([
  "scripts/migrate.js",
  "scripts/provider-routing-rehearsal.js",
  "scripts/seed-admin.js",
  "scripts/tenant-ingress-signature-drill.js",
  "scripts/tenant-isolation-audit.js",
  "scripts/tenant-query-scope-sweep.js",
  "scripts/tenant-scope-backfill-bundle.js",
  "scripts/tenant-scope-backfill-plan.js"
]);

const TENANT_SCOPED_TABLES = [
  "agent_drafts",
  "agent_integrations",
  "agent_outbox",
  "agent_run_events",
  "agent_run_steps",
  "agent_runs",
  "agent_tool_calls",
  "ai_guard_events",
  "ai_knowledge_chunks",
  "ai_knowledge_documents",
  "ai_knowledge_folders",
  "ai_knowledge_quarantine_events",
  "ai_knowledge_retrieval_events",
  "ai_policy_decisions",
  "ai_prompt_template_events",
  "ai_prompt_templates",
  "attachments",
  "audit_logs",
  "auth_identity_accounts",
  "auth_mfa_challenges",
  "auth_mfa_enrollments",
  "auth_mfa_factors",
  "auth_sessions",
  "call_events",
  "call_outbox_events",
  "call_provider_numbers",
  "call_review_writebacks",
  "call_sessions",
  "call_transcript_ai_jobs",
  "call_transcript_jobs",
  "csat_ratings",
  "customer_identities",
  "customer_merges",
  "customers",
  "email_outbox_events",
  "external_user_links",
  "inbound_alert_configs",
  "inbound_alerts",
  "inbound_events",
  "mailbox_memberships",
  "mailboxes",
  "macros",
  "merge_review_tasks",
  "messages",
  "organizations",
  "password_resets",
  "privileged_access_grants",
  "replies",
  "sla_configs",
  "spam_rules",
  "support_saved_views",
  "tags",
  "tenant_ingress_signing_secrets",
  "tenant_provider_webhook_secrets",
  "tenant_public_ingress_origins",
  "tenant_security_policies",
  "ticket_events",
  "ticket_links",
  "ticket_merges",
  "ticket_tags",
  "tickets",
  "users",
  "voice_consent_events",
  "voice_operator_presence",
  "whatsapp_accounts",
  "whatsapp_events",
  "whatsapp_status_events",
  "whatsapp_templates",
  "workspace_billing_adjustments",
  "workspace_billing_dunning_events",
  "workspace_billing_invoices",
  "workspace_billing_plan_changes",
  "workspace_billing_subscriptions",
  "workspace_module_usage_events",
  "workspace_modules",
  "workspaces"
];

const SUPPRESSION_REGEX = /tenant-scope-sweep:\s*ignore\b/i;
const TENANT_SCOPE_REGEX = /\btenant_key\b/i;

function normalizeRelativePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const envRoots = parseList(env.TENANT_QUERY_SCOPE_ROOTS);
  const options = {
    roots: envRoots.length > 0 ? envRoots : [...DEFAULT_ROOTS],
    maxFindings: 200,
    includePassed: false,
    json: false,
    output: env.TENANT_QUERY_SCOPE_OUTPUT || null,
    evidenceDir: env.TENANT_QUERY_SCOPE_EVIDENCE_DIR || null,
    failOn: env.TENANT_QUERY_SCOPE_FAIL_ON || "blocker",
    help: false
  };
  let sawRoot = false;

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
    if (name === "--root") {
      if (!sawRoot) {
        options.roots = [];
        sawRoot = true;
      }
      options.roots.push(readValue());
      continue;
    }
    if (name === "--max-findings") {
      options.maxFindings = Number.parseInt(readValue(), 10);
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
    if (name === "--fail-on") {
      options.failOn = readValue();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.roots = options.roots.map((root) => String(root || "").trim()).filter(Boolean);
  if (options.roots.length === 0) {
    throw new Error("at least one --root path is required");
  }
  if (!Number.isFinite(options.maxFindings) || options.maxFindings < 1 || options.maxFindings > 1000) {
    throw new Error("--max-findings must be an integer from 1 to 1000");
  }
  options.maxFindings = Math.trunc(options.maxFindings);
  if (!["blocker", "never"].includes(options.failOn)) {
    throw new Error("--fail-on must be blocker or never");
  }
  return options;
}

function helpText() {
  return [
    "Usage: node scripts/tenant-query-scope-sweep.js [options]",
    "       node scripts/tenant-query-scope-sweep.js --root=src/server",
    "",
    "Scans API, server, and worker SQL query calls for tenant-scoped tables that lack tenant_key evidence.",
    "The sweep is static and read-only. Suppress intentional global reads with: // tenant-scope-sweep: ignore <reason>",
    "",
    "Options:",
    "  --root=path                 Root to scan. Can be repeated. Defaults to src/app/api, src/server, scripts.",
    "  --max-findings=1..1000      Stop recording findings after this count. Default: 200.",
    "  --include-passed            Include passed query samples in the JSON report.",
    "  --json                      Print JSON instead of human summary.",
    "  --output=path               Write the full JSON report to a file.",
    "  --evidence-dir=path         Write a timestamped JSON report under the directory.",
    "  --fail-on=blocker|never     Exit non-zero when blockers exist. Default: blocker."
  ].join("\n");
}

function lineNumberAt(content, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content[cursor] === "\n") line += 1;
  }
  return line;
}

function findMatchingParen(content, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function skipTypeArguments(content, startIndex) {
  let index = startIndex;
  while (/\s/.test(content[index] || "")) index += 1;
  if (content[index] !== "<") return index;

  let depth = 0;
  for (; index < content.length; index += 1) {
    const char = content[index];
    if (char === "<") depth += 1;
    if (char === ">") {
      depth -= 1;
      if (depth === 0) {
        index += 1;
        break;
      }
    }
  }
  while (/\s/.test(content[index] || "")) index += 1;
  return index;
}

function findQuerySpans(content) {
  const spans = [];
  const queryWord = /\bquery\b/g;
  let match;
  while ((match = queryWord.exec(content)) !== null) {
    const openIndex = skipTypeArguments(content, match.index + match[0].length);
    if (content[openIndex] !== "(") continue;
    const closeIndex = findMatchingParen(content, openIndex);
    if (closeIndex === -1) continue;
    spans.push({
      start: match.index,
      end: closeIndex + 1,
      text: content.slice(match.index, closeIndex + 1),
      line: lineNumberAt(content, match.index),
      endLine: lineNumberAt(content, closeIndex)
    });
    queryWord.lastIndex = closeIndex + 1;
  }
  return spans;
}

function tableReferenceRegex(table) {
  const name = escapeRegex(table);
  return new RegExp(
    `\\b(?:from|join|update|into|insert\\s+into|delete\\s+from)\\s+(?:"?[a-z_][\\w$]*"?\\.)?"?${name}"?\\b`,
    "i"
  );
}

const TABLE_PATTERNS = TENANT_SCOPED_TABLES.map((table) => ({
  table,
  pattern: tableReferenceRegex(table)
}));

function referencedScopedTables(statement) {
  return TABLE_PATTERNS.filter(({ pattern }) => pattern.test(statement)).map(({ table }) => table);
}

function hasSuppression(lines, startLine) {
  const index = startLine - 1;
  const nearby = [lines[index - 2], lines[index - 1], lines[index]].filter(Boolean);
  return nearby.some((line) => SUPPRESSION_REGEX.test(line));
}

function redactFragment(statement) {
  const normalized = statement.replace(/\s+/g, " ").trim();
  return normalized.length > 260 ? `${normalized.slice(0, 257)}...` : normalized;
}

function shouldIgnoreFile(relativePath) {
  return IGNORED_FILES.has(normalizeRelativePath(relativePath));
}

function scanFileContent(relativePath, content, options = {}) {
  const lines = content.split(/\r?\n/);
  const spans = findQuerySpans(content);
  const findings = [];
  const passed = [];
  const suppressed = [];
  let scopedQueryCalls = 0;

  for (const span of spans) {
    const tables = referencedScopedTables(span.text);
    if (tables.length === 0) continue;
    scopedQueryCalls += 1;

    if (hasSuppression(lines, span.line)) {
      suppressed.push({
        file: relativePath,
        line: span.line,
        tables,
        reason: "suppression_comment"
      });
      continue;
    }

    if (TENANT_SCOPE_REGEX.test(span.text)) {
      if (options.includePassed) {
        passed.push({
          file: relativePath,
          line: span.line,
          tables,
          evidence: redactFragment(span.text)
        });
      }
      continue;
    }

    for (const table of tables) {
      findings.push({
        severity: "blocker",
        check: "missing_tenant_scope_predicate",
        file: relativePath,
        line: span.line,
        endLine: span.endLine,
        table,
        message: `Query references tenant-scoped table ${table} without tenant_key evidence in the query call.`,
        evidence: redactFragment(span.text)
      });
    }
  }

  return {
    file: relativePath,
    queryCalls: spans.length,
    scopedQueryCalls,
    findings,
    passed,
    suppressed
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(rootPath, cwd, files = []) {
  const absoluteRoot = path.resolve(cwd, rootPath);
  if (!(await pathExists(absoluteRoot))) return files;

  const stats = await fs.stat(absoluteRoot);
  if (stats.isFile()) {
    if (SOURCE_EXTENSIONS.has(path.extname(absoluteRoot))) {
      const relativePath = normalizeRelativePath(path.relative(cwd, absoluteRoot));
      if (!shouldIgnoreFile(relativePath)) files.push(absoluteRoot);
    }
    return files;
  }

  const entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(absoluteRoot, entry.name);
    const relativePath = normalizeRelativePath(path.relative(cwd, absolutePath));
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      await walkFiles(relativePath, cwd, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (shouldIgnoreFile(relativePath)) continue;
    files.push(absolutePath);
  }
  return files;
}

async function collectFiles(roots, cwd) {
  const files = [];
  const missingRoots = [];
  for (const root of roots) {
    const absoluteRoot = path.resolve(cwd, root);
    if (!(await pathExists(absoluteRoot))) {
      missingRoots.push(root);
      continue;
    }
    await walkFiles(root, cwd, files);
  }
  return {
    files: [...new Set(files)].sort(),
    missingRoots
  };
}

function summarize(results, allFindings, recordedFindings, options, missingRoots) {
  const blockerCount = allFindings.filter((finding) => finding.severity === "blocker").length;
  const warningCount = allFindings.filter((finding) => finding.severity === "warning").length;
  const scopedQueryCalls = results.reduce((sum, result) => sum + result.scopedQueryCalls, 0);
  const queryCalls = results.reduce((sum, result) => sum + result.queryCalls, 0);
  const suppressedCount = results.reduce((sum, result) => sum + result.suppressed.length, 0);
  const passedCount = results.reduce((sum, result) => sum + result.passed.length, 0);

  return {
    fileCount: results.length,
    queryCalls,
    scopedQueryCalls,
    passedCount,
    suppressedCount,
    blockerCount,
    warningCount,
    findingCount: allFindings.length,
    recordedFindingCount: recordedFindings.length,
    missingRoots,
    truncated: allFindings.length > recordedFindings.length
  };
}

async function runTenantQueryScopeSweep(options = {}, env = process.env) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const roots = options.roots || DEFAULT_ROOTS;
  const generatedAt = new Date().toISOString();
  const { files, missingRoots } = await collectFiles(roots, cwd);
  const results = [];
  const allFindings = [];

  for (const filePath of files) {
    const relativePath = normalizeRelativePath(path.relative(cwd, filePath));
    const content = await fs.readFile(filePath, "utf8");
    const result = scanFileContent(relativePath, content, options);
    results.push(result);
    allFindings.push(...result.findings);
  }

  const findings = allFindings.slice(0, options.maxFindings);
  const summary = summarize(results, allFindings, findings, options, missingRoots);
  return {
    formatVersion: FORMAT_VERSION,
    reportId: randomUUID(),
    generatedAt,
    cwd,
    roots,
    ready: summary.blockerCount === 0,
    writesDatabase: false,
    staticAnalysisOnly: true,
    scopedTables: TENANT_SCOPED_TABLES,
    summary,
    findings,
    passed: options.includePassed ? results.flatMap((result) => result.passed) : undefined,
    suppressed: results.flatMap((result) => result.suppressed),
    environment: {
      nodeEnv: env.NODE_ENV || "unknown"
    }
  };
}

async function writeSweepEvidence(report, outputPath) {
  if (!outputPath) return null;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

function evidencePathFor(options, report) {
  if (options.output) return path.resolve(options.output);
  if (!options.evidenceDir) return null;
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  return path.resolve(options.evidenceDir, `tenant-query-scope-sweep-${stamp}-${report.reportId}.json`);
}

function formatHuman(report) {
  const lines = [
    `Tenant query-scope sweep ${report.ready ? "passed" : "found blockers"}`,
    `Report: ${report.reportId}`,
    `Files: ${report.summary.fileCount}`,
    `Query calls: ${report.summary.queryCalls}`,
    `Scoped query calls: ${report.summary.scopedQueryCalls}`,
    `Findings: ${report.summary.findingCount} (${report.summary.blockerCount} blockers)`
  ];
  if (report.summary.missingRoots.length > 0) {
    lines.push(`Missing roots: ${report.summary.missingRoots.join(", ")}`);
  }
  if (report.summary.truncated) {
    lines.push(`Findings truncated at ${report.findings.length}. Increase --max-findings for the full report.`);
  }
  if (report.findings.length > 0) {
    lines.push("");
    lines.push("First findings:");
    for (const finding of report.findings.slice(0, 10)) {
      lines.push(`- ${finding.severity}: ${finding.file}:${finding.line} ${finding.table}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log(helpText());
    return;
  }

  const report = await runTenantQueryScopeSweep(options);
  const outputPath = evidencePathFor(options, report);
  if (outputPath) {
    await writeSweepEvidence(report, outputPath);
    report.outputPath = outputPath;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
    if (outputPath) console.log(`Evidence: ${outputPath}`);
  }

  if (options.failOn === "blocker" && !report.ready) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_ROOTS,
  FORMAT_VERSION,
  TENANT_SCOPED_TABLES,
  collectFiles,
  findQuerySpans,
  helpText,
  parseArgs,
  runTenantQueryScopeSweep,
  scanFileContent,
  writeSweepEvidence
};
