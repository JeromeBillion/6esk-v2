import { randomUUID } from "crypto";
import { db } from "@/server/db";

export type TenantIsolationAuditMode = "standard" | "external_launch";

export type TenantIsolationAuditSeverity = "blocker" | "warning" | "info";

export type TenantIsolationAuditCheckKind =
  | "missing_scope"
  | "orphan_tenant"
  | "orphan_workspace"
  | "orphan_parent"
  | "cross_tenant_reference"
  | "primary_bridge"
  | "unscoped_identity";

export type TenantIsolationAuditCheck = {
  key: string;
  tableName: string;
  check: TenantIsolationAuditCheckKind;
  severity: TenantIsolationAuditSeverity;
  count: number;
  sampleIds: string[];
  description: string;
  error?: string;
};

export type TenantIsolationAuditReport = {
  formatVersion: "tenant-isolation-audit.v1";
  reportId: string;
  generatedAt: string;
  mode: TenantIsolationAuditMode;
  ready: boolean;
  blockerCount: number;
  warningCount: number;
  infoCount: number;
  evaluatedCheckCount: number;
  failedCheckCount: number;
  passedCheckCount: number;
  sampleLimit: number;
  checks: TenantIsolationAuditCheck[];
  summary: {
    missingScopeRows: number;
    orphanTenantRows: number;
    orphanWorkspaceRows: number;
    orphanParentRows: number;
    crossTenantReferenceRows: number;
    primaryBridgeRows: number;
    unscopedIdentityRows: number;
  };
};

type SeverityResolver =
  | TenantIsolationAuditSeverity
  | ((mode: TenantIsolationAuditMode) => TenantIsolationAuditSeverity);

type CheckDefinition = {
  key: string;
  tableName: string;
  check: TenantIsolationAuditCheckKind;
  severity: SeverityResolver;
  countSql: string;
  sampleSql: string;
  description: string;
};

type ScopedTableSpec = {
  tableName: string;
  sampleExpression: string;
  qualifiedSampleExpression: string;
};

type RelationSpec = {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn?: string;
  childSampleExpression?: string;
  parentHasTenant?: boolean;
  nullable?: boolean;
};

const WORKSPACE_TABLES: ScopedTableSpec[] = [
  idTable("users"),
  {
    tableName: "tenant_security_policies",
    sampleExpression: "tenant_key || ':' || workspace_key",
    qualifiedSampleExpression: "t.tenant_key || ':' || t.workspace_key"
  },
  idTable("auth_sessions"),
  idTable("auth_identity_accounts"),
  idTable("auth_mfa_factors"),
  idTable("auth_mfa_enrollments"),
  idTable("auth_mfa_challenges"),
  idTable("password_resets"),
  idTable("privileged_access_grants"),
  idTable("mailboxes"),
  {
    tableName: "mailbox_memberships",
    sampleExpression: "mailbox_id::text || ':' || user_id::text",
    qualifiedSampleExpression: "t.mailbox_id::text || ':' || t.user_id::text"
  },
  idTable("messages"),
  idTable("attachments"),
  idTable("tickets"),
  idTable("ticket_events"),
  idTable("replies"),
  idTable("audit_logs"),
  idTable("sla_configs"),
  idTable("csat_ratings"),
  idTable("customers"),
  idTable("customer_identities"),
  idTable("ticket_merges"),
  idTable("customer_merges"),
  idTable("merge_review_tasks"),
  idTable("ticket_links"),
  idTable("external_user_links"),
  idTable("tags"),
  {
    tableName: "ticket_tags",
    sampleExpression: "ticket_id::text || ':' || tag_id::text",
    qualifiedSampleExpression: "t.ticket_id::text || ':' || t.tag_id::text"
  },
  idTable("macros"),
  idTable("support_saved_views"),
  idTable("inbound_events"),
  idTable("inbound_alerts"),
  idTable("inbound_alert_configs"),
  idTable("spam_rules"),
  idTable("whatsapp_accounts"),
  idTable("whatsapp_events"),
  idTable("whatsapp_templates"),
  idTable("whatsapp_status_events"),
  idTable("email_outbox_events"),
  idTable("call_provider_numbers"),
  idTable("tenant_ingress_signing_secrets"),
  idTable("tenant_provider_webhook_secrets"),
  idTable("tenant_public_ingress_origins"),
  idTable("call_sessions"),
  idTable("call_events"),
  idTable("call_outbox_events"),
  idTable("call_transcript_jobs"),
  idTable("call_transcript_ai_jobs"),
  idTable("ai_guard_events"),
  idTable("ai_policy_decisions"),
  idTable("ai_prompt_templates"),
  idTable("ai_prompt_template_events"),
  idTable("ai_knowledge_folders"),
  idTable("ai_knowledge_documents"),
  idTable("ai_knowledge_chunks"),
  idTable("ai_knowledge_retrieval_events"),
  idTable("ai_knowledge_quarantine_events"),
  {
    tableName: "workspace_modules",
    sampleExpression: "tenant_key || ':' || workspace_key",
    qualifiedSampleExpression: "t.tenant_key || ':' || t.workspace_key"
  },
  idTable("workspace_module_usage_events"),
  idTable("workspace_billing_subscriptions"),
  idTable("workspace_billing_plan_changes"),
  idTable("workspace_billing_invoices"),
  idTable("workspace_billing_adjustments"),
  idTable("workspace_billing_dunning_events")
];

const TENANT_TABLES: ScopedTableSpec[] = [
  {
    tableName: "organizations",
    sampleExpression: "tenant_key || ':' || organization_key",
    qualifiedSampleExpression: "t.tenant_key || ':' || t.organization_key"
  },
  idTable("agent_integrations"),
  idTable("agent_outbox"),
  idTable("agent_runs")
];

const PARENT_RELATIONS: RelationSpec[] = [
  relation("auth_sessions", "user_id", "users"),
  relation("auth_identity_accounts", "user_id", "users"),
  relation("auth_mfa_factors", "user_id", "users"),
  relation("auth_mfa_enrollments", "user_id", "users"),
  relation("auth_mfa_challenges", "user_id", "users"),
  relation("password_resets", "user_id", "users"),
  relation("privileged_access_grants", "requested_by_user_id", "users", { nullable: true }),
  relation("privileged_access_grants", "approved_by_user_id", "users", { nullable: true }),
  relation("privileged_access_grants", "revoked_by_user_id", "users", { nullable: true }),
  relation("workspace_billing_subscriptions", "created_by_user_id", "users", { nullable: true }),
  relation("workspace_billing_subscriptions", "updated_by_user_id", "users", { nullable: true }),
  relation("workspace_billing_plan_changes", "subscription_id", "workspace_billing_subscriptions"),
  relation("workspace_billing_plan_changes", "requested_by_user_id", "users", { nullable: true }),
  relation("workspace_billing_plan_changes", "applied_by_user_id", "users", { nullable: true }),
  relation("workspace_billing_invoices", "subscription_id", "workspace_billing_subscriptions"),
  relation("workspace_billing_invoices", "created_by_user_id", "users", { nullable: true }),
  relation("workspace_billing_invoices", "updated_by_user_id", "users", { nullable: true }),
  relation("workspace_billing_adjustments", "subscription_id", "workspace_billing_subscriptions"),
  relation("workspace_billing_adjustments", "invoice_id", "workspace_billing_invoices", { nullable: true }),
  relation("workspace_billing_adjustments", "created_by_user_id", "users", { nullable: true }),
  relation("workspace_billing_dunning_events", "subscription_id", "workspace_billing_subscriptions"),
  relation("workspace_billing_dunning_events", "invoice_id", "workspace_billing_invoices", { nullable: true }),
  relation("workspace_billing_dunning_events", "created_by_user_id", "users", { nullable: true }),
  relation("mailboxes", "owner_user_id", "users", { nullable: true }),
  relation("mailbox_memberships", "mailbox_id", "mailboxes", {
    childSampleExpression: "c.mailbox_id::text || ':' || c.user_id::text"
  }),
  relation("mailbox_memberships", "user_id", "users", {
    childSampleExpression: "c.mailbox_id::text || ':' || c.user_id::text"
  }),
  relation("messages", "mailbox_id", "mailboxes", { nullable: true }),
  relation("messages", "ticket_id", "tickets", { nullable: true }),
  relation("attachments", "message_id", "messages", { nullable: true }),
  relation("tickets", "mailbox_id", "mailboxes", { nullable: true }),
  relation("tickets", "customer_id", "customers", { nullable: true }),
  relation("tickets", "assigned_user_id", "users", { nullable: true }),
  relation("tickets", "merged_into_ticket_id", "tickets", { nullable: true }),
  relation("ticket_events", "ticket_id", "tickets", { nullable: true }),
  relation("ticket_events", "actor_user_id", "users", { nullable: true }),
  relation("replies", "ticket_id", "tickets", { nullable: true }),
  relation("replies", "message_id", "messages", { nullable: true }),
  relation("replies", "author_user_id", "users", { nullable: true }),
  relation("audit_logs", "actor_user_id", "users", { nullable: true }),
  relation("csat_ratings", "ticket_id", "tickets", { nullable: true }),
  relation("customers", "merged_into_customer_id", "customers", { nullable: true }),
  relation("customers", "merged_by_user_id", "users", { nullable: true }),
  relation("customer_identities", "customer_id", "customers"),
  relation("ticket_merges", "source_ticket_id", "tickets"),
  relation("ticket_merges", "target_ticket_id", "tickets"),
  relation("ticket_merges", "actor_user_id", "users", { nullable: true }),
  relation("customer_merges", "source_customer_id", "customers"),
  relation("customer_merges", "target_customer_id", "customers"),
  relation("customer_merges", "actor_user_id", "users", { nullable: true }),
  relation("merge_review_tasks", "ticket_id", "tickets", { nullable: true }),
  relation("merge_review_tasks", "source_ticket_id", "tickets", { nullable: true }),
  relation("merge_review_tasks", "target_ticket_id", "tickets", { nullable: true }),
  relation("merge_review_tasks", "source_customer_id", "customers", { nullable: true }),
  relation("merge_review_tasks", "target_customer_id", "customers", { nullable: true }),
  relation("merge_review_tasks", "proposed_by_agent_id", "agent_integrations", { nullable: true }),
  relation("merge_review_tasks", "proposed_by_user_id", "users", { nullable: true }),
  relation("merge_review_tasks", "reviewed_by_user_id", "users", { nullable: true }),
  relation("ticket_links", "source_ticket_id", "tickets"),
  relation("ticket_links", "target_ticket_id", "tickets"),
  relation("ticket_links", "source_customer_id", "customers", { nullable: true }),
  relation("ticket_links", "target_customer_id", "customers", { nullable: true }),
  relation("ticket_links", "actor_user_id", "users", { nullable: true }),
  relation("external_user_links", "last_ticket_id", "tickets", { nullable: true }),
  relation("ticket_tags", "ticket_id", "tickets", {
    childSampleExpression: "c.ticket_id::text || ':' || c.tag_id::text"
  }),
  relation("ticket_tags", "tag_id", "tags", {
    childSampleExpression: "c.ticket_id::text || ':' || c.tag_id::text"
  }),
  relation("support_saved_views", "user_id", "users", { nullable: true }),
  relation("inbound_events", "message_id", "messages", { nullable: true }),
  relation("inbound_events", "ticket_id", "tickets", { nullable: true }),
  relation("whatsapp_status_events", "message_id", "messages", { nullable: true }),
  relation("call_sessions", "ticket_id", "tickets"),
  relation("call_sessions", "mailbox_id", "mailboxes", { nullable: true }),
  relation("call_sessions", "message_id", "messages", { nullable: true }),
  relation("call_sessions", "created_by_user_id", "users", { nullable: true }),
  relation("call_sessions", "created_by_integration_id", "agent_integrations", { nullable: true }),
  relation("call_events", "call_session_id", "call_sessions"),
  relation("call_transcript_jobs", "call_session_id", "call_sessions"),
  relation("call_transcript_ai_jobs", "call_session_id", "call_sessions"),
  relation("ai_prompt_template_events", "template_id", "ai_prompt_templates", { nullable: true }),
  relation("ai_prompt_template_events", "actor_user_id", "users", { nullable: true }),
  relation("ai_knowledge_folders", "parent_id", "ai_knowledge_folders", { nullable: true }),
  relation("ai_knowledge_documents", "folder_id", "ai_knowledge_folders", { nullable: true }),
  relation("ai_knowledge_chunks", "document_id", "ai_knowledge_documents")
];

const PARENT_OWNED_TABLES: RelationSpec[] = [
  relation("agent_run_events", "run_id", "agent_runs"),
  relation("agent_run_steps", "run_id", "agent_runs"),
  relation("agent_tool_calls", "run_id", "agent_runs"),
  relation("agent_tool_calls", "step_id", "agent_run_steps", { nullable: true, parentHasTenant: false }),
  relation("agent_drafts", "ticket_id", "tickets", { nullable: true }),
  relation("agent_drafts", "integration_id", "agent_integrations", { nullable: true }),
  relation("voice_operator_presence", "user_id", "users", {
    childSampleExpression: "c.user_id::text"
  }),
  relation("voice_operator_presence", "active_call_session_id", "call_sessions", {
    childSampleExpression: "c.user_id::text",
    nullable: true
  }),
  relation("voice_consent_events", "customer_id", "customers", { nullable: true }),
  relation("call_review_writebacks", "ticket_id", "tickets"),
  relation("call_review_writebacks", "call_session_id", "call_sessions")
];

function idTable(tableName: string): ScopedTableSpec {
  return {
    tableName,
    sampleExpression: "id::text",
    qualifiedSampleExpression: "t.id::text"
  };
}

function relation(
  childTable: string,
  childColumn: string,
  parentTable: string,
  options: Pick<RelationSpec, "childSampleExpression" | "nullable" | "parentHasTenant"> = {}
): RelationSpec {
  return {
    childTable,
    childColumn,
    parentTable,
    parentColumn: "id",
    childSampleExpression: options.childSampleExpression ?? "c.id::text",
    parentHasTenant: options.parentHasTenant ?? true,
    nullable: options.nullable
  };
}

function primaryBridgeSeverity(mode: TenantIsolationAuditMode) {
  return mode === "external_launch" ? "blocker" : "warning";
}

function scopedPresenceWhere(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}tenant_key IS NULL OR btrim(${prefix}tenant_key) = '' OR ${prefix}workspace_key IS NULL OR btrim(${prefix}workspace_key) = '')`;
}

function tenantPresenceWhere(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}tenant_key IS NULL OR btrim(${prefix}tenant_key) = '')`;
}

function relationPresentWhere(spec: RelationSpec, alias = "c") {
  return spec.nullable ? `${alias}.${spec.childColumn} IS NOT NULL` : "true";
}

function buildDefinitions(): CheckDefinition[] {
  const definitions: CheckDefinition[] = [
    {
      key: "tenants.primary_bridge",
      tableName: "tenants",
      check: "primary_bridge",
      severity: primaryBridgeSeverity,
      countSql: "SELECT COUNT(*)::text AS count FROM tenants WHERE tenant_key = 'primary'",
      sampleSql:
        "SELECT tenant_key AS sample_id FROM tenants WHERE tenant_key = 'primary' ORDER BY sample_id LIMIT $1",
      description:
        "The legacy primary tenant compatibility bridge still exists; this must be cleared or formally isolated before external launch."
    }
  ];

  for (const table of TENANT_TABLES) {
    definitions.push(
      {
        key: `${table.tableName}.missing_tenant_scope`,
        tableName: table.tableName,
        check: "missing_scope",
        severity: "blocker",
        countSql: `SELECT COUNT(*)::text AS count FROM ${table.tableName} WHERE ${tenantPresenceWhere()}`,
        sampleSql: `SELECT ${table.sampleExpression} AS sample_id FROM ${table.tableName} WHERE ${tenantPresenceWhere()} ORDER BY sample_id LIMIT $1`,
        description: `${table.tableName} has rows without a tenant key.`
      },
      {
        key: `${table.tableName}.orphan_tenant`,
        tableName: table.tableName,
        check: "orphan_tenant",
        severity: "blocker",
        countSql:
          `SELECT COUNT(*)::text AS count
           FROM ${table.tableName} t
           LEFT JOIN tenants tenant ON tenant.tenant_key = t.tenant_key
           WHERE NOT ${tenantPresenceWhere("t")}
             AND tenant.tenant_key IS NULL`,
        sampleSql:
          `SELECT ${table.qualifiedSampleExpression} AS sample_id
           FROM ${table.tableName} t
           LEFT JOIN tenants tenant ON tenant.tenant_key = t.tenant_key
           WHERE NOT ${tenantPresenceWhere("t")}
             AND tenant.tenant_key IS NULL
           ORDER BY sample_id
           LIMIT $1`,
        description: `${table.tableName} references a tenant that does not exist.`
      },
      {
        key: `${table.tableName}.primary_bridge`,
        tableName: table.tableName,
        check: "primary_bridge",
        severity: primaryBridgeSeverity,
        countSql: `SELECT COUNT(*)::text AS count FROM ${table.tableName} WHERE tenant_key = 'primary'`,
        sampleSql: `SELECT ${table.sampleExpression} AS sample_id FROM ${table.tableName} WHERE tenant_key = 'primary' ORDER BY sample_id LIMIT $1`,
        description: `${table.tableName} still contains legacy primary tenant rows.`
      }
    );
  }

  definitions.push(
    {
      key: "workspaces.missing_scope",
      tableName: "workspaces",
      check: "missing_scope",
      severity: "blocker",
      countSql: `SELECT COUNT(*)::text AS count FROM workspaces WHERE ${scopedPresenceWhere()}`,
      sampleSql: `SELECT tenant_key || ':' || workspace_key AS sample_id FROM workspaces WHERE ${scopedPresenceWhere()} ORDER BY sample_id LIMIT $1`,
      description: "workspaces has rows without a complete tenant/workspace key."
    },
    {
      key: "workspaces.orphan_tenant",
      tableName: "workspaces",
      check: "orphan_tenant",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM workspaces w
         LEFT JOIN tenants tenant ON tenant.tenant_key = w.tenant_key
         WHERE NOT ${scopedPresenceWhere("w")}
           AND tenant.tenant_key IS NULL`,
      sampleSql:
        `SELECT w.tenant_key || ':' || w.workspace_key AS sample_id
         FROM workspaces w
         LEFT JOIN tenants tenant ON tenant.tenant_key = w.tenant_key
         WHERE NOT ${scopedPresenceWhere("w")}
           AND tenant.tenant_key IS NULL
         ORDER BY sample_id
         LIMIT $1`,
      description: "workspaces references a tenant that does not exist."
    },
    {
      key: "workspaces.orphan_organization",
      tableName: "workspaces",
      check: "orphan_parent",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM workspaces w
         LEFT JOIN organizations org
           ON org.tenant_key = w.tenant_key
          AND org.organization_key = w.organization_key
         WHERE w.organization_key IS NOT NULL
           AND org.organization_key IS NULL`,
      sampleSql:
        `SELECT w.tenant_key || ':' || w.workspace_key AS sample_id
         FROM workspaces w
         LEFT JOIN organizations org
           ON org.tenant_key = w.tenant_key
          AND org.organization_key = w.organization_key
         WHERE w.organization_key IS NOT NULL
           AND org.organization_key IS NULL
         ORDER BY sample_id
         LIMIT $1`,
      description: "workspaces references an organization that does not exist inside the same tenant."
    },
    {
      key: "workspaces.primary_bridge",
      tableName: "workspaces",
      check: "primary_bridge",
      severity: primaryBridgeSeverity,
      countSql: "SELECT COUNT(*)::text AS count FROM workspaces WHERE tenant_key = 'primary' OR workspace_key = 'primary'",
      sampleSql:
        "SELECT tenant_key || ':' || workspace_key AS sample_id FROM workspaces WHERE tenant_key = 'primary' OR workspace_key = 'primary' ORDER BY sample_id LIMIT $1",
      description: "workspaces still contains legacy primary tenant/workspace rows."
    }
  );

  for (const table of WORKSPACE_TABLES) {
    definitions.push(
      {
        key: `${table.tableName}.missing_scope`,
        tableName: table.tableName,
        check: "missing_scope",
        severity: "blocker",
        countSql: `SELECT COUNT(*)::text AS count FROM ${table.tableName} WHERE ${scopedPresenceWhere()}`,
        sampleSql: `SELECT ${table.sampleExpression} AS sample_id FROM ${table.tableName} WHERE ${scopedPresenceWhere()} ORDER BY sample_id LIMIT $1`,
        description: `${table.tableName} has rows without a complete tenant/workspace key.`
      },
      {
        key: `${table.tableName}.orphan_workspace`,
        tableName: table.tableName,
        check: "orphan_workspace",
        severity: "blocker",
        countSql:
          `SELECT COUNT(*)::text AS count
           FROM ${table.tableName} t
           LEFT JOIN workspaces workspace
             ON workspace.tenant_key = t.tenant_key
            AND workspace.workspace_key = t.workspace_key
           WHERE NOT ${scopedPresenceWhere("t")}
             AND workspace.workspace_key IS NULL`,
        sampleSql:
          `SELECT ${table.qualifiedSampleExpression} AS sample_id
           FROM ${table.tableName} t
           LEFT JOIN workspaces workspace
             ON workspace.tenant_key = t.tenant_key
            AND workspace.workspace_key = t.workspace_key
           WHERE NOT ${scopedPresenceWhere("t")}
             AND workspace.workspace_key IS NULL
           ORDER BY sample_id
           LIMIT $1`,
        description: `${table.tableName} references a workspace that does not exist inside its tenant.`
      },
      {
        key: `${table.tableName}.primary_bridge`,
        tableName: table.tableName,
        check: "primary_bridge",
        severity: primaryBridgeSeverity,
        countSql: `SELECT COUNT(*)::text AS count FROM ${table.tableName} WHERE tenant_key = 'primary' OR workspace_key = 'primary'`,
        sampleSql: `SELECT ${table.sampleExpression} AS sample_id FROM ${table.tableName} WHERE tenant_key = 'primary' OR workspace_key = 'primary' ORDER BY sample_id LIMIT $1`,
        description: `${table.tableName} still contains legacy primary tenant/workspace rows.`
      }
    );
  }

  for (const relationSpec of PARENT_RELATIONS) {
    definitions.push(...buildScopedRelationDefinitions(relationSpec));
  }

  for (const relationSpec of PARENT_OWNED_TABLES) {
    definitions.push(...buildParentOwnedDefinitions(relationSpec));
  }

  definitions.push({
    key: "voice_consent_events.unscoped_identity_without_customer",
    tableName: "voice_consent_events",
    check: "unscoped_identity",
    severity: "blocker",
    countSql: "SELECT COUNT(*)::text AS count FROM voice_consent_events WHERE customer_id IS NULL",
    sampleSql:
      "SELECT id::text AS sample_id FROM voice_consent_events WHERE customer_id IS NULL ORDER BY sample_id LIMIT $1",
    description:
      "voice_consent_events rows without customer_id cannot be deterministically attributed to a tenant."
  });

  definitions.push({
    key: "call_review_writebacks.ticket_session_cross_tenant",
    tableName: "call_review_writebacks",
    check: "cross_tenant_reference",
    severity: "blocker",
    countSql:
      `SELECT COUNT(*)::text AS count
       FROM call_review_writebacks c
       JOIN tickets t ON t.id = c.ticket_id
       JOIN call_sessions s ON s.id = c.call_session_id
       WHERE t.tenant_key <> s.tenant_key
          OR t.workspace_key <> s.workspace_key`,
    sampleSql:
      `SELECT c.id::text AS sample_id
       FROM call_review_writebacks c
       JOIN tickets t ON t.id = c.ticket_id
       JOIN call_sessions s ON s.id = c.call_session_id
       WHERE t.tenant_key <> s.tenant_key
          OR t.workspace_key <> s.workspace_key
       ORDER BY sample_id
       LIMIT $1`,
    description: "call_review_writebacks links tickets and call sessions from different tenant/workspace scopes."
  });

  return definitions;
}

function buildScopedRelationDefinitions(spec: RelationSpec): CheckDefinition[] {
  const parentColumn = spec.parentColumn ?? "id";
  const presentWhere = relationPresentWhere(spec);
  const parentJoin = `p.${parentColumn} = c.${spec.childColumn}`;
  return [
    {
      key: `${spec.childTable}.${spec.childColumn}.orphan_parent`,
      tableName: spec.childTable,
      check: "orphan_parent",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${spec.childTable} c
         LEFT JOIN ${spec.parentTable} p ON ${parentJoin}
         WHERE ${presentWhere}
           AND p.${parentColumn} IS NULL`,
      sampleSql:
        `SELECT ${spec.childSampleExpression ?? "c.id::text"} AS sample_id
         FROM ${spec.childTable} c
         LEFT JOIN ${spec.parentTable} p ON ${parentJoin}
         WHERE ${presentWhere}
           AND p.${parentColumn} IS NULL
         ORDER BY sample_id
         LIMIT $1`,
      description: `${spec.childTable}.${spec.childColumn} references a missing ${spec.parentTable} row.`
    },
    {
      key: `${spec.childTable}.${spec.childColumn}.cross_tenant_reference`,
      tableName: spec.childTable,
      check: "cross_tenant_reference",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${spec.childTable} c
         JOIN ${spec.parentTable} p ON ${parentJoin}
         WHERE ${presentWhere}
           AND c.tenant_key <> p.tenant_key`,
      sampleSql:
        `SELECT ${spec.childSampleExpression ?? "c.id::text"} AS sample_id
         FROM ${spec.childTable} c
         JOIN ${spec.parentTable} p ON ${parentJoin}
         WHERE ${presentWhere}
           AND c.tenant_key <> p.tenant_key
         ORDER BY sample_id
         LIMIT $1`,
      description: `${spec.childTable}.${spec.childColumn} points at a ${spec.parentTable} row in another tenant.`
    }
  ];
}

function buildParentOwnedDefinitions(spec: RelationSpec): CheckDefinition[] {
  const parentColumn = spec.parentColumn ?? "id";
  const presentWhere = relationPresentWhere(spec);
  const parentJoin = `p.${parentColumn} = c.${spec.childColumn}`;
  const definitions: CheckDefinition[] = [
    {
      key: `${spec.childTable}.${spec.childColumn}.orphan_parent`,
      tableName: spec.childTable,
      check: "orphan_parent",
      severity: "blocker",
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${spec.childTable} c
         LEFT JOIN ${spec.parentTable} p ON ${parentJoin}
         WHERE ${presentWhere}
           AND p.${parentColumn} IS NULL`,
      sampleSql:
        `SELECT ${spec.childSampleExpression ?? "c.id::text"} AS sample_id
         FROM ${spec.childTable} c
         LEFT JOIN ${spec.parentTable} p ON ${parentJoin}
         WHERE ${presentWhere}
           AND p.${parentColumn} IS NULL
         ORDER BY sample_id
         LIMIT $1`,
      description: `${spec.childTable}.${spec.childColumn} references a missing ${spec.parentTable} row.`
    }
  ];

  if (spec.parentHasTenant === false) {
    return definitions;
  }

  definitions.push(
    {
      key: `${spec.childTable}.${spec.childColumn}.primary_bridge_parent`,
      tableName: spec.childTable,
      check: "primary_bridge",
      severity: primaryBridgeSeverity,
      countSql:
        `SELECT COUNT(*)::text AS count
         FROM ${spec.childTable} c
         JOIN ${spec.parentTable} p ON ${parentJoin}
         WHERE ${presentWhere}
           AND p.tenant_key = 'primary'`,
      sampleSql:
        `SELECT ${spec.childSampleExpression ?? "c.id::text"} AS sample_id
         FROM ${spec.childTable} c
         JOIN ${spec.parentTable} p ON ${parentJoin}
         WHERE ${presentWhere}
           AND p.tenant_key = 'primary'
         ORDER BY sample_id
         LIMIT $1`,
      description: `${spec.childTable}.${spec.childColumn} is still owned by a legacy primary tenant parent row.`
    }
  );

  return definitions;
}

function resolveSeverity(severity: SeverityResolver, mode: TenantIsolationAuditMode) {
  return typeof severity === "function" ? severity(mode) : severity;
}

function readSampleLimit(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) {
    return 10;
  }
  return Math.min(Math.max(Math.trunc(value ?? 10), 1), 25);
}

function readCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown audit query failure";
}

async function runDefinition(
  definition: CheckDefinition,
  mode: TenantIsolationAuditMode,
  sampleLimit: number
): Promise<TenantIsolationAuditCheck> {
  const severity = resolveSeverity(definition.severity, mode);
  try {
    const countResult = await db.query<{ count: string | number }>(definition.countSql);
    const count = readCount(countResult.rows[0]?.count);
    const sampleResult =
      count > 0
        ? await db.query<{ sample_id: string | null }>(definition.sampleSql, [sampleLimit])
        : { rows: [] };

    return {
      key: definition.key,
      tableName: definition.tableName,
      check: definition.check,
      severity,
      count,
      sampleIds: sampleResult.rows.map((row) => String(row.sample_id ?? "")).filter(Boolean),
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

export async function runTenantIsolationAudit(
  options: {
    mode?: TenantIsolationAuditMode | null;
    sampleLimit?: number | null;
    includePassed?: boolean | null;
  } = {}
): Promise<TenantIsolationAuditReport> {
  const mode = options.mode ?? "standard";
  const sampleLimit = readSampleLimit(options.sampleLimit);
  const definitions = buildDefinitions();
  const allChecks: TenantIsolationAuditCheck[] = [];

  for (const definition of definitions) {
    allChecks.push(await runDefinition(definition, mode, sampleLimit));
  }

  const failedChecks = allChecks.filter((check) => check.count > 0);
  const visibleChecks = options.includePassed ? allChecks : failedChecks;
  const blockerCount = failedChecks.filter((check) => check.severity === "blocker").length;
  const warningCount = failedChecks.filter((check) => check.severity === "warning").length;
  const infoCount = failedChecks.filter((check) => check.severity === "info").length;

  return {
    formatVersion: "tenant-isolation-audit.v1",
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
    checks: visibleChecks,
    summary: {
      missingScopeRows: sumByCheck(failedChecks, "missing_scope"),
      orphanTenantRows: sumByCheck(failedChecks, "orphan_tenant"),
      orphanWorkspaceRows: sumByCheck(failedChecks, "orphan_workspace"),
      orphanParentRows: sumByCheck(failedChecks, "orphan_parent"),
      crossTenantReferenceRows: sumByCheck(failedChecks, "cross_tenant_reference"),
      primaryBridgeRows: sumByCheck(failedChecks, "primary_bridge"),
      unscopedIdentityRows: sumByCheck(failedChecks, "unscoped_identity")
    }
  };
}

function sumByCheck(checks: TenantIsolationAuditCheck[], check: TenantIsolationAuditCheckKind) {
  return checks
    .filter((result) => result.check === check)
    .reduce((total, result) => total + result.count, 0);
}
