import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { resolveTenantScope, type TenantScope, type TenantScopeInput } from "@/server/tenant-context";

type QueryTarget = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: T[] }>;
};

export type TenantOffboardingMode = "anonymize" | "delete";

export type TenantOffboardingPlannedAction =
  | "anonymize"
  | "delete_ephemeral"
  | "deactivate"
  | "retain_audit_evidence"
  | "retain_usage_evidence"
  | "delete_requires_rehearsal";

export type TenantOffboardingTablePlan = {
  key: string;
  source: string;
  scope: "tenant" | "workspace";
  rowCount: number;
  plannedAction: TenantOffboardingPlannedAction;
  note?: string;
};

export type TenantOffboardingMutationResult = {
  key: string;
  source: string;
  affectedRows: number;
  action: TenantOffboardingPlannedAction;
};

export type TenantOffboardingReport = {
  formatVersion: "tenant-offboarding.v1";
  operationId: string;
  generatedAt: string;
  tenantKey: string;
  workspaceKey: string;
  mode: TenantOffboardingMode;
  dryRun: boolean;
  confirmationRequired: string;
  totalRows: number;
  tableCount: number;
  blockers: string[];
  warnings: string[];
  residualRisks: string[];
  legalHold: {
    knowledgeDocumentCount: number;
  };
  tables: TenantOffboardingTablePlan[];
  mutations: TenantOffboardingMutationResult[];
};

export class TenantOffboardingError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "tenant_offboarding_error") {
    super(message);
    this.name = "TenantOffboardingError";
    this.status = status;
    this.code = code;
  }
}

type CountSpec = {
  key: string;
  source: string;
  scope: "tenant" | "workspace";
  countSql: string;
  plannedAction: TenantOffboardingPlannedAction;
  note?: string;
};

type MutationSpec = {
  key: string;
  source: string;
  action: TenantOffboardingPlannedAction;
  sql: string;
};

const TENANT_COUNT_SPECS: CountSpec[] = [
  tenantTable("tenants", "anonymize", "Tenant profile is renamed and closed; key is retained for audit joins."),
  tenantTable("organizations", "anonymize", "Organization profile is renamed and closed."),
  tenantTable("agent_integrations", "deactivate", "Agent integrations are disabled and secrets are redacted.")
];

const WORKSPACE_COUNT_SPECS: CountSpec[] = [
  workspaceTable("workspaces", "anonymize", "Workspace profile is renamed and closed."),
  workspaceTable("tenant_security_policies", "deactivate", "Federated login policy is disabled."),
  workspaceTable("workspace_modules", "deactivate", "Module entitlements are disabled."),
  workspaceTable("workspace_module_usage_events", "retain_usage_evidence"),
  workspaceTable("workspace_billing_subscriptions", "deactivate", "Subscription state is canceled and provider references are redacted."),
  workspaceTable("workspace_billing_plan_changes", "retain_audit_evidence"),
  workspaceTable("workspace_billing_invoices", "retain_usage_evidence"),
  workspaceTable("workspace_billing_adjustments", "retain_audit_evidence"),
  workspaceTable("workspace_billing_dunning_events", "retain_audit_evidence"),
  workspaceTable("users", "anonymize"),
  workspaceTable("auth_sessions", "delete_ephemeral"),
  workspaceTable("auth_identity_accounts", "anonymize"),
  workspaceTable("auth_mfa_factors", "deactivate"),
  workspaceTable("auth_mfa_enrollments", "delete_ephemeral"),
  workspaceTable("auth_mfa_challenges", "delete_ephemeral"),
  workspaceTable("password_resets", "delete_ephemeral"),
  workspaceTable("mailboxes", "anonymize"),
  workspaceTable("mailbox_memberships", "retain_audit_evidence"),
  workspaceTable("customers", "anonymize"),
  workspaceTable("customer_identities", "anonymize"),
  workspaceTable("tickets", "anonymize"),
  workspaceTable("messages", "anonymize"),
  workspaceTable("attachments", "anonymize"),
  workspaceTable("ticket_events", "anonymize"),
  workspaceTable("replies", "anonymize"),
  workspaceTable("audit_logs", "retain_audit_evidence"),
  workspaceTable("privileged_access_grants", "retain_audit_evidence"),
  workspaceTable("sla_configs", "deactivate"),
  workspaceTable("csat_ratings", "retain_usage_evidence"),
  workspaceTable("ticket_merges", "retain_audit_evidence"),
  workspaceTable("customer_merges", "retain_audit_evidence"),
  workspaceTable("merge_review_tasks", "anonymize"),
  workspaceTable("ticket_links", "retain_audit_evidence"),
  workspaceTable("external_user_links", "anonymize"),
  workspaceTable("tags", "anonymize"),
  workspaceTable("ticket_tags", "retain_audit_evidence"),
  workspaceTable("macros", "anonymize"),
  workspaceTable("support_saved_views", "anonymize"),
  workspaceTable("inbound_events", "anonymize"),
  workspaceTable("inbound_alerts", "retain_audit_evidence"),
  workspaceTable("inbound_alert_configs", "deactivate"),
  workspaceTable("spam_rules", "deactivate"),
  workspaceTable("whatsapp_accounts", "deactivate"),
  workspaceTable("whatsapp_events", "anonymize"),
  workspaceTable("whatsapp_templates", "deactivate"),
  workspaceTable("whatsapp_status_events", "anonymize"),
  workspaceTable("email_outbox_events", "anonymize"),
  workspaceTable("call_provider_numbers", "deactivate"),
  workspaceTable("tenant_ingress_signing_secrets", "deactivate"),
  workspaceTable("tenant_provider_webhook_secrets", "deactivate"),
  workspaceTable("tenant_public_ingress_origins", "deactivate"),
  workspaceTable("call_sessions", "anonymize"),
  workspaceTable("call_events", "anonymize"),
  workspaceTable("call_outbox_events", "anonymize"),
  workspaceTable("call_transcript_jobs", "anonymize"),
  workspaceTable("call_transcript_ai_jobs", "anonymize"),
  workspaceTable("voice_operator_presence", "deactivate"),
  workspaceTable("voice_consent_events", "anonymize", "Consent state is retained; identity values are redacted."),
  workspaceTable("call_review_writebacks", "anonymize"),
  workspaceTable("agent_outbox", "anonymize"),
  workspaceTable("agent_runs", "anonymize"),
  workspaceTable("agent_run_events", "anonymize"),
  workspaceTable("agent_run_steps", "anonymize"),
  workspaceTable("agent_tool_calls", "anonymize"),
  workspaceTable("agent_drafts", "anonymize"),
  workspaceTable("ai_guard_events", "anonymize"),
  workspaceTable("ai_policy_decisions", "anonymize"),
  workspaceTable("ai_knowledge_folders", "anonymize"),
  workspaceTable("ai_knowledge_documents", "anonymize", "Legal-hold documents block execution."),
  workspaceTable("ai_knowledge_chunks", "anonymize", "Chunks for legal-hold documents are preserved."),
  workspaceTable("ai_knowledge_retrieval_events", "anonymize"),
  workspaceTable("ai_knowledge_quarantine_events", "anonymize"),
  workspaceTable("ai_prompt_templates", "anonymize"),
  workspaceTable("ai_prompt_template_events", "anonymize")
];

const COUNT_SPECS = [...TENANT_COUNT_SPECS, ...WORKSPACE_COUNT_SPECS];

const ANONYMIZATION_MUTATIONS: MutationSpec[] = [
  deleteEphemeral("auth_sessions"),
  deleteEphemeral("password_resets"),
  deleteEphemeral("auth_mfa_challenges"),
  deleteEphemeral("auth_mfa_enrollments"),
  mutation(
    "auth_mfa_factors",
    "deactivate",
    `WITH updated AS (
       UPDATE auth_mfa_factors
          SET label = NULL,
              secret_encrypted = NULL,
              credential_id = CASE WHEN credential_id IS NULL THEN NULL ELSE 'redacted:' || id::text END,
              disabled_at = COALESCE(disabled_at, now())
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "auth_identity_accounts",
    "anonymize",
    `WITH updated AS (
       UPDATE auth_identity_accounts
          SET provider_account_id = 'redacted:' || id::text,
              provider_email = NULL,
              access_token_encrypted = NULL,
              refresh_token_encrypted = NULL,
              scopes = ARRAY[]::text[],
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "tenant_security_policies",
    "deactivate",
    `WITH updated AS (
       UPDATE tenant_security_policies
          SET allowed_login_domains = ARRAY[]::text[],
              enforce_sso = false,
              require_mfa_for_admins = true,
              auth_provider = 'password',
              oidc_issuer = NULL,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "users",
    "anonymize",
    `WITH updated AS (
       UPDATE users
          SET email = 'deleted-user-' || id::text || '@redacted.invalid',
              display_name = 'Deleted user',
              password_hash = 'offboarded:' || id::text,
              is_active = false,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "mailboxes",
    "anonymize",
    `WITH updated AS (
       UPDATE mailboxes
          SET address = 'deleted-mailbox-' || id::text || '@redacted.invalid',
              owner_user_id = NULL,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "customers",
    "anonymize",
    `WITH updated AS (
       UPDATE customers
          SET external_system = NULL,
              external_user_id = NULL,
              display_name = 'Deleted customer',
              primary_email = NULL,
              primary_phone = NULL,
              address = NULL,
              merge_reason = NULL,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "customer_identities",
    "anonymize",
    `WITH updated AS (
       UPDATE customer_identities
          SET identity_value = 'redacted:' || id::text,
              is_primary = false,
              source = 'tenant_offboarding',
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "tickets",
    "anonymize",
    `WITH updated AS (
       UPDATE tickets
          SET requester_email = 'deleted-ticket-' || id::text || '@redacted.invalid',
              subject = '[redacted]',
              category = NULL,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "messages",
    "anonymize",
    `WITH updated AS (
       UPDATE messages
          SET message_id = NULL,
              thread_id = NULL,
              external_message_id = NULL,
              conversation_id = NULL,
              wa_contact = NULL,
              in_reply_to = NULL,
              reference_ids = ARRAY[]::text[],
              from_email = 'deleted-message-' || id::text || '@redacted.invalid',
              to_emails = ARRAY[]::text[],
              cc_emails = ARRAY[]::text[],
              bcc_emails = ARRAY[]::text[],
              subject = '[redacted]',
              preview_text = NULL,
              r2_key_raw = NULL,
              r2_key_html = NULL,
              r2_key_text = NULL,
              ai_meta = NULL,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "attachments",
    "anonymize",
    `WITH updated AS (
       UPDATE attachments
          SET filename = 'redacted-attachment',
              content_type = NULL,
              size_bytes = NULL,
              r2_key = 'redacted/offboarding/' || id::text
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ticket_events",
    "anonymize",
    `WITH updated AS (
       UPDATE ticket_events
          SET data = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "replies",
    "anonymize",
    `WITH updated AS (
       UPDATE replies
          SET body_text = NULL,
              body_html = NULL
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "external_user_links",
    "anonymize",
    `WITH updated AS (
       UPDATE external_user_links
          SET external_system = 'redacted',
              external_user_id = 'redacted:' || id::text,
              email = 'deleted-link-' || id::text || '@redacted.invalid',
              phone = NULL,
              matched_by = NULL,
              confidence = NULL,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "tags",
    "anonymize",
    `WITH updated AS (
       UPDATE tags
          SET name = 'redacted-tag-' || id::text,
              description = NULL
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "macros",
    "anonymize",
    `WITH updated AS (
       UPDATE macros
          SET title = 'redacted-macro-' || id::text,
              category = NULL,
              body = '[redacted]',
              is_active = false,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "support_saved_views",
    "anonymize",
    `WITH updated AS (
       UPDATE support_saved_views
          SET name = 'Redacted view ' || left(id::text, 8),
              filters = '{}'::jsonb,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "inbound_events",
    "anonymize",
    `WITH updated AS (
       UPDATE inbound_events
          SET payload = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              last_error = NULL,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "inbound_alert_configs",
    "deactivate",
    `WITH updated AS (
       UPDATE inbound_alert_configs
          SET webhook_url = NULL,
              is_active = false,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "spam_rules",
    "deactivate",
    `WITH updated AS (
       UPDATE spam_rules
          SET is_active = false,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "whatsapp_accounts",
    "deactivate",
    `WITH updated AS (
       UPDATE whatsapp_accounts
          SET phone_number = '+000' || right(replace(id::text, '-', ''), 12),
              waba_id = NULL,
              access_token = NULL,
              verify_token = NULL,
              status = 'inactive',
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  jsonbRedaction("whatsapp_events", "payload"),
  mutation(
    "whatsapp_templates",
    "deactivate",
    `WITH updated AS (
       UPDATE whatsapp_templates
          SET name = 'redacted-template-' || id::text,
              category = NULL,
              status = 'inactive',
              components = jsonb_build_array(),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "whatsapp_status_events",
    "anonymize",
    `WITH updated AS (
       UPDATE whatsapp_status_events
          SET external_message_id = NULL,
              payload = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  jsonbRedaction("email_outbox_events", "payload"),
  mutation(
    "call_provider_numbers",
    "deactivate",
    `WITH updated AS (
       UPDATE call_provider_numbers
          SET phone_number = '+000' || right(replace(id::text, '-', ''), 12),
              account_sid = NULL,
              status = 'revoked',
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "tenant_ingress_signing_secrets",
    "deactivate",
    `WITH updated AS (
       UPDATE tenant_ingress_signing_secrets
          SET label = 'Redacted ingress secret',
              status = 'revoked',
              secret_ciphertext = 'redacted:' || id::text,
              secret_nonce = 'redacted:' || id::text,
              secret_tag = 'redacted:' || id::text,
              secret_fingerprint = 'redacted:' || id::text,
              last_used_at = NULL,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "tenant_provider_webhook_secrets",
    "deactivate",
    `WITH updated AS (
       UPDATE tenant_provider_webhook_secrets
          SET provider_account_id = NULL,
              label = 'Redacted provider webhook secret',
              status = 'revoked',
              secret_ciphertext = 'redacted:' || id::text,
              secret_nonce = 'redacted:' || id::text,
              secret_tag = 'redacted:' || id::text,
              secret_fingerprint = 'redacted:' || id::text,
              last_used_at = NULL,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "tenant_public_ingress_origins",
    "deactivate",
    `WITH updated AS (
       UPDATE tenant_public_ingress_origins
          SET origin = 'https://redacted-' || id::text || '.invalid',
              status = 'inactive',
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "call_sessions",
    "anonymize",
    `WITH updated AS (
       UPDATE call_sessions
          SET provider_call_id = NULL,
              from_phone = NULL,
              to_phone = '+000' || right(replace(id::text, '-', ''), 12),
              recording_url = NULL,
              recording_r2_key = NULL,
              transcript_r2_key = NULL,
              idempotency_key = NULL,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  jsonbRedaction("call_events", { hasUpdatedAt: false }, "payload"),
  jsonbRedaction("call_outbox_events", "payload"),
  mutation(
    "call_transcript_jobs",
    "anonymize",
    `WITH updated AS (
       UPDATE call_transcript_jobs
          SET provider_job_id = NULL,
              recording_r2_key = 'redacted/offboarding/' || id::text,
              transcript_r2_key = NULL,
              last_error = NULL,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "call_transcript_ai_jobs",
    "anonymize",
    `WITH updated AS (
       UPDATE call_transcript_ai_jobs
          SET provider_job_id = NULL,
              transcript_r2_key = 'redacted/offboarding/' || id::text,
              last_error = NULL,
              summary = NULL,
              resolution_note = NULL,
              qa_flags = jsonb_build_array(),
              action_items = jsonb_build_array(),
              raw_response = '{}'::jsonb,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "voice_operator_presence",
    "deactivate",
    `WITH updated AS (
       UPDATE voice_operator_presence
          SET active_call_session_id = NULL,
              status = 'offline',
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "voice_consent_events",
    "anonymize",
    `WITH updated AS (
       UPDATE voice_consent_events
          SET identity_value = 'redacted:' || id::text,
              callback_phone = NULL,
              terms_version = NULL,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "call_review_writebacks",
    "anonymize",
    `WITH updated AS (
       UPDATE call_review_writebacks
          SET idempotency_key = 'redacted:' || id::text,
              source = 'tenant_offboarding',
              payload = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  jsonbRedaction("agent_outbox", "payload", "command_envelope"),
  mutation(
    "agent_runs",
    "anonymize",
    `WITH updated AS (
       UPDATE agent_runs
          SET resource = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              command_envelope = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              error = NULL,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  jsonbRedaction("agent_run_events", { hasUpdatedAt: false }, "data"),
  mutation(
    "agent_run_steps",
    "anonymize",
    `WITH updated AS (
       UPDATE agent_run_steps
          SET input = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              output = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              error = NULL
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "agent_tool_calls",
    "anonymize",
    `WITH updated AS (
       UPDATE agent_tool_calls
          SET request = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              response = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              error = NULL
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "agent_drafts",
    "anonymize",
    `WITH updated AS (
       UPDATE agent_drafts
          SET subject = '[redacted]',
              body_text = NULL,
              body_html = NULL,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "agent_integrations",
    "deactivate",
    `WITH updated AS (
       UPDATE agent_integrations
          SET name = 'Redacted agent integration ' || left(id::text, 8),
              base_url = 'https://redacted.invalid',
              shared_secret = 'redacted:' || id::text,
              status = 'inactive',
              scopes = '{}'::jsonb,
              capabilities = '{}'::jsonb,
              updated_at = now()
        WHERE tenant_key = $1
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ai_guard_events",
    "anonymize",
    `WITH updated AS (
       UPDATE ai_guard_events
          SET content_sample = NULL,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ai_policy_decisions",
    "anonymize",
    `WITH updated AS (
       UPDATE ai_policy_decisions
          SET resource = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ai_knowledge_folders",
    "anonymize",
    `WITH updated AS (
       UPDATE ai_knowledge_folders
          SET name = 'Redacted folder ' || left(id::text, 8),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ai_knowledge_documents",
    "anonymize",
    `WITH updated AS (
       UPDATE ai_knowledge_documents
          SET filename = 'redacted-document-' || id::text || '.txt',
              title = 'Redacted document',
              extraction_error = NULL,
              body_text = '',
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              status = 'deleted',
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
          AND COALESCE(metadata #>> '{retention,legalHold}', 'false') <> 'true'
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ai_knowledge_chunks",
    "anonymize",
    `WITH updated AS (
       UPDATE ai_knowledge_chunks chunk
          SET content = '[redacted]',
              token_estimate = 0,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE chunk.tenant_key = $1
          AND chunk.workspace_key = $2
          AND NOT EXISTS (
            SELECT 1
              FROM ai_knowledge_documents document
             WHERE document.id = chunk.document_id
               AND document.tenant_key = $1
               AND document.workspace_key = $2
               AND COALESCE(document.metadata #>> '{retention,legalHold}', 'false') = 'true'
          )
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ai_knowledge_retrieval_events",
    "anonymize",
    `WITH updated AS (
       UPDATE ai_knowledge_retrieval_events
          SET query = '[redacted]',
              result_count = 0,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ai_knowledge_quarantine_events",
    "anonymize",
    `WITH updated AS (
       UPDATE ai_knowledge_quarantine_events
          SET filename = 'redacted-quarantine-' || id::text,
              content_type = 'application/octet-stream',
              detail = NULL,
              storage_bucket = NULL,
              storage_key = NULL,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ai_prompt_templates",
    "anonymize",
    `WITH updated AS (
       UPDATE ai_prompt_templates
          SET template_body = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              template_hash = 'redacted:' || id::text,
              status = 'retired',
              retired_at = COALESCE(retired_at, now()),
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "ai_prompt_template_events",
    "anonymize",
    `WITH updated AS (
       UPDATE ai_prompt_template_events
          SET reason = NULL,
              metadata = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "workspace_modules",
    "deactivate",
    `WITH updated AS (
       UPDATE workspace_modules
          SET modules = '{}'::jsonb,
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
      SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "workspace_billing_subscriptions",
    "deactivate",
    `WITH updated AS (
       UPDATE workspace_billing_subscriptions
          SET status = 'canceled',
              collection_status = 'suspended',
              provider_customer_ref = NULL,
              provider_subscription_ref = NULL,
              metadata = metadata || jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3),
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
        RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "workspaces",
    "anonymize",
    `WITH updated AS (
       UPDATE workspaces
          SET name = 'Closed workspace',
              status = 'closed',
              updated_at = now()
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "organizations",
    "anonymize",
    `WITH updated AS (
       UPDATE organizations
          SET name = 'Closed organization',
              status = 'closed',
              updated_at = now()
        WHERE tenant_key = $1
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  ),
  mutation(
    "tenants",
    "anonymize",
    `WITH updated AS (
       UPDATE tenants
          SET name = 'Closed tenant',
              status = 'closed',
              updated_at = now()
        WHERE tenant_key = $1
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  )
];

function tenantTable(
  source: string,
  plannedAction: TenantOffboardingPlannedAction,
  note?: string
): CountSpec {
  return {
    key: source,
    source,
    scope: "tenant",
    plannedAction,
    note,
    countSql: `SELECT COUNT(*)::text AS count FROM ${source} WHERE tenant_key = $1`
  };
}

function workspaceTable(
  source: string,
  plannedAction: TenantOffboardingPlannedAction,
  note?: string
): CountSpec {
  return {
    key: source,
    source,
    scope: "workspace",
    plannedAction,
    note,
    countSql: `SELECT COUNT(*)::text AS count FROM ${source} WHERE tenant_key = $1 AND workspace_key = $2`
  };
}

function mutation(
  source: string,
  action: TenantOffboardingPlannedAction,
  sql: string,
  key = source
): MutationSpec {
  return { key, source, action, sql };
}

function deleteEphemeral(source: string) {
  return mutation(
    source,
    "delete_ephemeral",
    `WITH deleted AS (
       DELETE FROM ${source}
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM deleted`
  );
}

function jsonbRedaction(
  source: string,
  optionsOrColumn: { hasUpdatedAt?: boolean } | string,
  ...remainingColumns: string[]
) {
  const options =
    typeof optionsOrColumn === "string" ? { hasUpdatedAt: true } : { hasUpdatedAt: optionsOrColumn.hasUpdatedAt !== false };
  const columns = typeof optionsOrColumn === "string" ? [optionsOrColumn, ...remainingColumns] : remainingColumns;
  const redactions = columns
    .map(
      (column) =>
        `${column} = jsonb_build_object('tenantOffboardingRedacted', true, 'operationId', $4, 'redactedAt', $3)`
    )
    .join(",\n              ");
  const updatedAt = options.hasUpdatedAt ? ",\n              updated_at = now()" : "";
  return mutation(
    source,
    "anonymize",
    `WITH updated AS (
       UPDATE ${source}
          SET ${redactions}${updatedAt}
        WHERE tenant_key = $1
          AND workspace_key = $2
       RETURNING 1
     )
     SELECT COUNT(*)::text AS count FROM updated`
  );
}

function readCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countParams(spec: CountSpec, scope: TenantScope) {
  return spec.scope === "tenant" ? [scope.tenantKey] : [scope.tenantKey, scope.workspaceKey];
}

async function countRows(target: QueryTarget, spec: CountSpec, scope: TenantScope) {
  const result = await target.query<{ count: string | number }>(spec.countSql, countParams(spec, scope));
  return readCount(result.rows[0]?.count);
}

async function countLegalHoldDocuments(target: QueryTarget, scope: TenantScope) {
  const result = await target.query<{ count: string | number }>(
    `SELECT COUNT(*)::text AS count
       FROM ai_knowledge_documents
      WHERE tenant_key = $1
        AND workspace_key = $2
        AND COALESCE(metadata #>> '{retention,legalHold}', 'false') = 'true'`,
    [scope.tenantKey, scope.workspaceKey]
  );
  return readCount(result.rows[0]?.count);
}

function expectedConfirmation(mode: TenantOffboardingMode, scope: TenantScope) {
  return `${mode.toUpperCase()} ${scope.tenantKey}/${scope.workspaceKey}`;
}

function buildStaticBlockers(mode: TenantOffboardingMode, scope: TenantScope, legalHoldDocumentCount: number) {
  const blockers: string[] = [];
  if (scope.tenantKey === "primary" || scope.workspaceKey === "primary") {
    blockers.push("The legacy primary compatibility scope cannot be offboarded destructively.");
  }
  if (legalHoldDocumentCount > 0) {
    blockers.push("Knowledge documents under legal hold must be released or handled by legal process first.");
  }
  if (mode === "delete") {
    blockers.push(
      "Physical tenant delete remains preview-only until backup/restore, R2 object deletion, and legal-hold drills are proven."
    );
  }
  return blockers;
}

export async function previewTenantOffboarding(
  scopeInput?: TenantScopeInput,
  options: {
    mode?: TenantOffboardingMode | null;
    operationId?: string | null;
  } = {}
): Promise<TenantOffboardingReport> {
  const scope = resolveTenantScope(scopeInput);
  const mode = options.mode ?? "anonymize";
  const operationId = options.operationId?.trim() || randomUUID();
  const tables: TenantOffboardingTablePlan[] = [];
  for (const spec of COUNT_SPECS) {
    const rowCount = await countRows(db as QueryTarget, spec, scope);
    tables.push({
      key: spec.key,
      source: spec.source,
      scope: spec.scope,
      rowCount,
      plannedAction: mode === "delete" ? "delete_requires_rehearsal" : spec.plannedAction,
      note: spec.note
    });
  }
  const legalHoldDocumentCount = await countLegalHoldDocuments(db as QueryTarget, scope);

  return {
    formatVersion: "tenant-offboarding.v1",
    operationId,
    generatedAt: new Date().toISOString(),
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    mode,
    dryRun: true,
    confirmationRequired: expectedConfirmation(mode, scope),
    totalRows: tables.reduce((total, table) => total + table.rowCount, 0),
    tableCount: tables.length,
    blockers: buildStaticBlockers(mode, scope, legalHoldDocumentCount),
    warnings: [
      "Tenant-level rows affect every workspace under the same tenant_key.",
      "Object payloads in R2 are not deleted by anonymization; use the export manifest and R2 lifecycle runbook for object destruction evidence."
    ],
    residualRisks: [
      "Global Better Auth adapter tables are not tenant-scoped; only bridged auth_identity_accounts are tenant-safe in this workflow.",
      "Audit, usage, CSAT, consent, merge, and link records are retained as evidence with sensitive payloads minimized where implemented."
    ],
    legalHold: {
      knowledgeDocumentCount: legalHoldDocumentCount
    },
    tables,
    mutations: []
  };
}

export async function executeTenantOffboardingAnonymization({
  scope: scopeInput,
  confirmation,
  reason,
  actorUserId,
  accessMode,
  privilegedAccessGrantId
}: {
  scope?: TenantScopeInput;
  confirmation?: string | null;
  reason?: string | null;
  actorUserId?: string | null;
  accessMode: "tenant_admin" | "privileged_access";
  privilegedAccessGrantId?: string | null;
}): Promise<TenantOffboardingReport> {
  const scope = resolveTenantScope(scopeInput);
  const operationId = randomUUID();
  const expected = expectedConfirmation("anonymize", scope);
  if ((confirmation ?? "").trim() !== expected) {
    throw new TenantOffboardingError(`Confirmation must exactly match "${expected}".`, 400, "confirmation_mismatch");
  }
  const trimmedReason = reason?.trim() ?? "";
  if (trimmedReason.length < 12) {
    throw new TenantOffboardingError("A concrete offboarding reason is required.", 400, "reason_required");
  }

  const preview = await previewTenantOffboarding(scope, { mode: "anonymize", operationId });
  if (preview.blockers.length > 0) {
    throw new TenantOffboardingError(preview.blockers[0], 409, "offboarding_blocked");
  }

  const client = await db.connect();
  const redactedAt = new Date().toISOString();
  const mutations: TenantOffboardingMutationResult[] = [];
  try {
    await client.query("BEGIN");
    for (const spec of ANONYMIZATION_MUTATIONS) {
      const result = await client.query<{ count: string | number }>(spec.sql, [
        scope.tenantKey,
        scope.workspaceKey,
        redactedAt,
        operationId
      ]);
      mutations.push({
        key: spec.key,
        source: spec.source,
        action: spec.action,
        affectedRows: readCount(result.rows[0]?.count)
      });
    }

    await client.query(
      `INSERT INTO audit_logs (tenant_key, workspace_key, actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        actorUserId ?? null,
        "tenant_offboarding_anonymization_executed",
        "tenant_offboarding",
        operationId,
        {
          reason: trimmedReason,
          accessMode,
          privilegedAccessGrantId: privilegedAccessGrantId ?? null,
          redactedAt,
          mutationCount: mutations.length,
          affectedRows: mutations.reduce((total, mutationResult) => total + mutationResult.affectedRows, 0),
          residualRisks: preview.residualRisks,
          warnings: preview.warnings
        }
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return {
    ...preview,
    dryRun: false,
    generatedAt: redactedAt,
    mutations
  };
}

export function tenantOffboardingErrorResponse(error: unknown) {
  if (error instanceof TenantOffboardingError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return null;
}
