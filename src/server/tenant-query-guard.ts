export const TENANT_QUERY_GUARD_MODES = ["off", "warn", "strict"] as const;

export type TenantQueryGuardMode = (typeof TENANT_QUERY_GUARD_MODES)[number];

export const TENANT_SCOPED_QUERY_TABLES = [
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
] as const;

export type TenantQueryGuardInspection = {
  sql: string | null;
  tables: string[];
  hasTenantScope: boolean;
  suppressed: boolean;
  missingTenantScope: boolean;
};

export class TenantQueryGuardError extends Error {
  inspection: TenantQueryGuardInspection;

  constructor(message: string, inspection: TenantQueryGuardInspection) {
    super(message);
    this.name = "TenantQueryGuardError";
    this.inspection = inspection;
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSql(queryTextOrConfig: unknown) {
  if (typeof queryTextOrConfig === "string") return queryTextOrConfig;
  if (
    queryTextOrConfig &&
    typeof queryTextOrConfig === "object" &&
    typeof (queryTextOrConfig as { text?: unknown }).text === "string"
  ) {
    return (queryTextOrConfig as { text: string }).text;
  }
  return null;
}

function stripSqlForInspection(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ")
    .replace(/'([^']|'')*'/g, "''")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, "$$")
    .replace(/\$\$[\s\S]*?\$\$/g, "$$");
}

function tablePattern(table: string) {
  const escaped = escapeRegex(table);
  return new RegExp(`(?:\\b|")${escaped}(?:\\b|")`, "i");
}

function isSuppressed(sql: string) {
  return /\btenant-query-guard:\s*ignore\b/i.test(sql) || /\btenant-scope-sweep:\s*ignore\b/i.test(sql);
}

export function resolveTenantQueryGuardMode(env: Pick<NodeJS.ProcessEnv, string> = process.env): TenantQueryGuardMode {
  const raw = env.TENANT_QUERY_GUARD_MODE?.trim().toLowerCase();
  if (raw && TENANT_QUERY_GUARD_MODES.includes(raw as TenantQueryGuardMode)) {
    return raw as TenantQueryGuardMode;
  }
  return env.NODE_ENV === "production" ? "strict" : "off";
}

export function inspectTenantQueryScope(queryTextOrConfig: unknown): TenantQueryGuardInspection {
  const sql = readSql(queryTextOrConfig);
  if (!sql) {
    return {
      sql: null,
      tables: [],
      hasTenantScope: false,
      suppressed: false,
      missingTenantScope: false
    };
  }

  const inspectable = stripSqlForInspection(sql);
  const tables = TENANT_SCOPED_QUERY_TABLES.filter((table) => tablePattern(table).test(inspectable));
  const hasTenantScope = /\btenant_key\b/i.test(inspectable);
  const suppressed = isSuppressed(sql);

  return {
    sql,
    tables,
    hasTenantScope,
    suppressed,
    missingTenantScope: tables.length > 0 && !hasTenantScope && !suppressed
  };
}

export function enforceTenantQueryGuard(
  queryTextOrConfig: unknown,
  options: {
    mode?: TenantQueryGuardMode;
    logger?: Pick<typeof console, "warn">;
    source?: string;
  } = {}
) {
  const mode = options.mode ?? resolveTenantQueryGuardMode();
  const inspection = inspectTenantQueryScope(queryTextOrConfig);
  if (mode === "off" || !inspection.missingTenantScope) {
    return inspection;
  }

  const source = options.source ? ` from ${options.source}` : "";
  const message = `Tenant query guard blocked${source}: scoped table query lacks tenant_key evidence (${inspection.tables.join(", ")}).`;
  if (mode === "strict") {
    throw new TenantQueryGuardError(message, inspection);
  }

  (options.logger ?? console).warn(message);
  return inspection;
}
