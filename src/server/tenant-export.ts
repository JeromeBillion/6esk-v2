import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";

export type TenantExportSection = {
  key: string;
  source: string;
  rowCount: number;
  exportedCount: number;
  truncated: boolean;
  redactedColumns: string[];
  rows: Record<string, unknown>[];
};

export type TenantExportObjectRef = {
  section: string;
  rowId: string | null;
  field: string;
  key: string;
  filename?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
};

export type TenantExportBundle = {
  formatVersion: "tenant-export.v1";
  exportId: string;
  tenantKey: string;
  workspaceKey: string;
  generatedAt: string;
  limitPerSection: number;
  sectionCount: number;
  totalRows: number;
  exportedRows: number;
  redaction: {
    secretsRedacted: true;
    redactedColumnsBySection: Record<string, string[]>;
  };
  objectStorageManifest: TenantExportObjectRef[];
  sections: TenantExportSection[];
};

type SectionSpec = {
  key: string;
  source: string;
  redactedColumns?: string[];
  countSql: string;
  rowsSql: (projection: string) => string;
  countParams: (scope: { tenantKey: string; workspaceKey: string }) => unknown[];
  rowsParams: (scope: { tenantKey: string; workspaceKey: string }, limit: number) => unknown[];
};

const WORKSPACE_TABLES = [
  "workspaces",
  "workspace_modules",
  "workspace_module_usage_events",
  "users",
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
  "ai_guard_events",
  "ai_policy_decisions",
  "ai_knowledge_folders",
  "ai_knowledge_documents",
  "ai_knowledge_chunks",
  "ai_knowledge_retrieval_events",
  "ai_knowledge_quarantine_events",
  "ai_prompt_templates",
  "ai_prompt_template_events"
] as const;

function buildJsonProjection(redactedColumns: string[] = []) {
  return redactedColumns.reduce((expression, column) => `${expression} - '${column}'`, "to_jsonb(row)");
}

function workspaceTableSpec(table: (typeof WORKSPACE_TABLES)[number], redactedColumns: string[] = []): SectionSpec {
  return {
    key: table,
    source: table,
    redactedColumns,
    countSql: `SELECT COUNT(*)::text AS count FROM ${table} WHERE tenant_key = $1 AND workspace_key = $2`,
    rowsSql: (projection) =>
      `SELECT ${projection} AS row
       FROM (
         SELECT *
         FROM ${table}
         WHERE tenant_key = $1
           AND workspace_key = $2
         LIMIT $3
       ) row`,
    countParams: (scope) => [scope.tenantKey, scope.workspaceKey],
    rowsParams: (scope, limit) => [scope.tenantKey, scope.workspaceKey, limit]
  };
}

function tenantTableSpec(table: string, redactedColumns: string[] = []): SectionSpec {
  return {
    key: table,
    source: table,
    redactedColumns,
    countSql: `SELECT COUNT(*)::text AS count FROM ${table} WHERE tenant_key = $1`,
    rowsSql: (projection) =>
      `SELECT ${projection} AS row
       FROM (
         SELECT *
         FROM ${table}
         WHERE tenant_key = $1
         LIMIT $2
       ) row`,
    countParams: (scope) => [scope.tenantKey],
    rowsParams: (scope, limit) => [scope.tenantKey, limit]
  };
}

const TENANT_EXPORT_SECTIONS: SectionSpec[] = [
  {
    key: "tenant",
    source: "tenants",
    countSql: "SELECT COUNT(*)::text AS count FROM tenants WHERE tenant_key = $1",
    rowsSql: (projection) =>
      `SELECT ${projection} AS row
       FROM (
         SELECT *
         FROM tenants
         WHERE tenant_key = $1
         LIMIT $2
       ) row`,
    countParams: (scope) => [scope.tenantKey],
    rowsParams: (scope, limit) => [scope.tenantKey, limit]
  },
  tenantTableSpec("organizations"),
  workspaceTableSpec("workspaces"),
  workspaceTableSpec("workspace_modules"),
  workspaceTableSpec("workspace_module_usage_events"),
  workspaceTableSpec("users", ["password_hash"]),
  workspaceTableSpec("mailboxes"),
  workspaceTableSpec("mailbox_memberships"),
  workspaceTableSpec("customers"),
  workspaceTableSpec("customer_identities"),
  workspaceTableSpec("tickets"),
  workspaceTableSpec("messages"),
  workspaceTableSpec("attachments"),
  workspaceTableSpec("ticket_events"),
  workspaceTableSpec("replies"),
  workspaceTableSpec("audit_logs"),
  workspaceTableSpec("sla_configs"),
  workspaceTableSpec("csat_ratings"),
  workspaceTableSpec("ticket_merges"),
  workspaceTableSpec("customer_merges"),
  workspaceTableSpec("merge_review_tasks"),
  workspaceTableSpec("ticket_links"),
  workspaceTableSpec("external_user_links"),
  workspaceTableSpec("tags"),
  workspaceTableSpec("ticket_tags"),
  workspaceTableSpec("macros"),
  workspaceTableSpec("support_saved_views"),
  workspaceTableSpec("inbound_events"),
  workspaceTableSpec("inbound_alerts"),
  workspaceTableSpec("inbound_alert_configs"),
  workspaceTableSpec("spam_rules"),
  workspaceTableSpec("whatsapp_accounts", ["access_token", "verify_token"]),
  workspaceTableSpec("whatsapp_events"),
  workspaceTableSpec("whatsapp_templates"),
  workspaceTableSpec("whatsapp_status_events"),
  workspaceTableSpec("email_outbox_events"),
  workspaceTableSpec("call_provider_numbers"),
  workspaceTableSpec("tenant_ingress_signing_secrets", [
    "secret_ciphertext",
    "secret_nonce",
    "secret_tag"
  ]),
  workspaceTableSpec("tenant_provider_webhook_secrets", [
    "secret_ciphertext",
    "secret_nonce",
    "secret_tag"
  ]),
  workspaceTableSpec("tenant_public_ingress_origins"),
  workspaceTableSpec("call_sessions"),
  workspaceTableSpec("call_events"),
  workspaceTableSpec("call_outbox_events"),
  workspaceTableSpec("call_transcript_jobs"),
  workspaceTableSpec("call_transcript_ai_jobs"),
  tenantTableSpec("agent_integrations", ["shared_secret"]),
  tenantTableSpec("agent_outbox"),
  tenantTableSpec("agent_runs"),
  {
    key: "agent_run_events",
    source: "agent_run_events",
    countSql:
      `SELECT COUNT(*)::text AS count
       FROM agent_run_events e
       JOIN agent_runs r ON r.id = e.run_id
       WHERE r.tenant_key = $1`,
    rowsSql: (projection) =>
      `SELECT ${projection} AS row
       FROM (
         SELECT e.*
         FROM agent_run_events e
         JOIN agent_runs r ON r.id = e.run_id
         WHERE r.tenant_key = $1
         LIMIT $2
       ) row`,
    countParams: (scope) => [scope.tenantKey],
    rowsParams: (scope, limit) => [scope.tenantKey, limit]
  },
  {
    key: "agent_run_steps",
    source: "agent_run_steps",
    countSql:
      `SELECT COUNT(*)::text AS count
       FROM agent_run_steps s
       JOIN agent_runs r ON r.id = s.run_id
       WHERE r.tenant_key = $1`,
    rowsSql: (projection) =>
      `SELECT ${projection} AS row
       FROM (
         SELECT s.*
         FROM agent_run_steps s
         JOIN agent_runs r ON r.id = s.run_id
         WHERE r.tenant_key = $1
         LIMIT $2
       ) row`,
    countParams: (scope) => [scope.tenantKey],
    rowsParams: (scope, limit) => [scope.tenantKey, limit]
  },
  {
    key: "agent_tool_calls",
    source: "agent_tool_calls",
    countSql:
      `SELECT COUNT(*)::text AS count
       FROM agent_tool_calls c
       JOIN agent_runs r ON r.id = c.run_id
       WHERE r.tenant_key = $1`,
    rowsSql: (projection) =>
      `SELECT ${projection} AS row
       FROM (
         SELECT c.*
         FROM agent_tool_calls c
         JOIN agent_runs r ON r.id = c.run_id
         WHERE r.tenant_key = $1
         LIMIT $2
       ) row`,
    countParams: (scope) => [scope.tenantKey],
    rowsParams: (scope, limit) => [scope.tenantKey, limit]
  },
  {
    key: "agent_drafts",
    source: "agent_drafts",
    countSql:
      `SELECT COUNT(*)::text AS count
       FROM agent_drafts d
       JOIN tickets t ON t.id = d.ticket_id
       WHERE t.tenant_key = $1
         AND t.workspace_key = $2`,
    rowsSql: (projection) =>
      `SELECT ${projection} AS row
       FROM (
         SELECT d.*
         FROM agent_drafts d
         JOIN tickets t ON t.id = d.ticket_id
         WHERE t.tenant_key = $1
           AND t.workspace_key = $2
         LIMIT $3
       ) row`,
    countParams: (scope) => [scope.tenantKey, scope.workspaceKey],
    rowsParams: (scope, limit) => [scope.tenantKey, scope.workspaceKey, limit]
  },
  workspaceTableSpec("ai_guard_events"),
  workspaceTableSpec("ai_policy_decisions"),
  workspaceTableSpec("ai_knowledge_folders"),
  workspaceTableSpec("ai_knowledge_documents"),
  workspaceTableSpec("ai_knowledge_chunks"),
  workspaceTableSpec("ai_knowledge_retrieval_events"),
  workspaceTableSpec("ai_knowledge_quarantine_events"),
  workspaceTableSpec("ai_prompt_templates"),
  workspaceTableSpec("ai_prompt_template_events")
];

function readLimitPerSection(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) {
    return 500;
  }
  return Math.min(Math.max(Math.trunc(value ?? 500), 1), 5_000);
}

async function exportSection(
  spec: SectionSpec,
  scope: { tenantKey: string; workspaceKey: string },
  limitPerSection: number
): Promise<TenantExportSection> {
  const countResult = await db.query<{ count: string }>(spec.countSql, spec.countParams(scope));
  const rowCount = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);
  const rowsResult = await db.query<{ row: Record<string, unknown> }>(
    spec.rowsSql(buildJsonProjection(spec.redactedColumns)),
    spec.rowsParams(scope, limitPerSection)
  );
  const rows = rowsResult.rows.map((result) => result.row);
  return {
    key: spec.key,
    source: spec.source,
    rowCount,
    exportedCount: rows.length,
    truncated: rowCount > rows.length,
    redactedColumns: spec.redactedColumns ?? [],
    rows
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addObjectRef(
  refs: TenantExportObjectRef[],
  section: string,
  row: Record<string, unknown>,
  field: string,
  extras: Partial<Omit<TenantExportObjectRef, "section" | "rowId" | "field" | "key">> = {}
) {
  const key = readString(row[field]);
  if (!key) {
    return;
  }
  refs.push({
    section,
    rowId: readString(row.id),
    field,
    key,
    ...extras
  });
}

function buildObjectStorageManifest(sections: TenantExportSection[]) {
  const refs: TenantExportObjectRef[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      if (section.key === "messages") {
        addObjectRef(refs, section.key, row, "r2_key_raw");
        addObjectRef(refs, section.key, row, "r2_key_html");
        addObjectRef(refs, section.key, row, "r2_key_text");
      }
      if (section.key === "attachments") {
        addObjectRef(refs, section.key, row, "r2_key", {
          filename: readString(row.filename),
          contentType: readString(row.content_type),
          sizeBytes: readNumber(row.size_bytes)
        });
      }
      if (section.key === "call_sessions") {
        addObjectRef(refs, section.key, row, "recording_r2_key", {
          filename: "call-recording",
          contentType: "audio"
        });
        addObjectRef(refs, section.key, row, "transcript_r2_key", {
          filename: "call-transcript.txt",
          contentType: "text/plain"
        });
      }
      if (section.key === "ai_knowledge_quarantine_events") {
        addObjectRef(refs, section.key, row, "storage_key", {
          filename: readString(row.filename),
          contentType: readString(row.content_type),
          sizeBytes: readNumber(row.byte_size)
        });
      }
    }
  }
  return refs;
}

export async function exportTenantDataBundle(
  scopeInput?: TenantScopeInput,
  options: { limitPerSection?: number | null } = {}
): Promise<TenantExportBundle> {
  const scope = resolveTenantScope(scopeInput);
  const limitPerSection = readLimitPerSection(options.limitPerSection);
  const sections: TenantExportSection[] = [];
  for (const spec of TENANT_EXPORT_SECTIONS) {
    sections.push(await exportSection(spec, scope, limitPerSection));
  }
  const redactedColumnsBySection = Object.fromEntries(
    sections
      .filter((section) => section.redactedColumns.length > 0)
      .map((section) => [section.key, section.redactedColumns])
  );
  const objectStorageManifest = buildObjectStorageManifest(sections);

  return {
    formatVersion: "tenant-export.v1",
    exportId: randomUUID(),
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    generatedAt: new Date().toISOString(),
    limitPerSection,
    sectionCount: sections.length,
    totalRows: sections.reduce((total, section) => total + section.rowCount, 0),
    exportedRows: sections.reduce((total, section) => total + section.exportedCount, 0),
    redaction: {
      secretsRedacted: true,
      redactedColumnsBySection
    },
    objectStorageManifest,
    sections
  };
}
