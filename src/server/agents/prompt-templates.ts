import { createHash } from "crypto";
import { db } from "@/server/db";
import {
  AGENT_PROMPT_TEMPLATE_KEY,
  buildAgentPromptSandbox,
  type AgentPromptSandbox
} from "@/server/agents/prompt-sandbox";
import { resolveTenantScope, type TenantScopeInput } from "@/server/tenant-context";
import type { CanonicalAgentPolicyMode } from "@/server/agents/policy-modes";
import type { AgentCustomerContext } from "@/server/agents/customer-context";

export type AgentPromptTemplateStatus = "draft" | "active" | "retired";

export type AgentPromptTemplateRecord = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  template_key: string;
  template_version: string;
  status: AgentPromptTemplateStatus | string;
  template_body: Record<string, unknown>;
  template_hash: string;
  activated_at: Date | null;
  retired_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type RuntimePromptSandboxInput = {
  tenantKey: string;
  workspaceKey?: string | null;
  mode: CanonicalAgentPolicyMode;
  eventType: string;
  payload: Record<string, unknown>;
  policy?: Record<string, unknown> | null;
  customerContext?: AgentCustomerContext | null;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashPromptTemplateBody(value: Record<string, unknown>) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function toSandboxTemplate(template: AgentPromptTemplateRecord | null) {
  if (!template) return null;
  return {
    templateKey: template.template_key,
    templateVersion: template.template_version,
    templateHash: template.template_hash,
    templateBody: template.template_body
  };
}

export async function listAgentPromptTemplates(
  scopeInput?: TenantScopeInput,
  input: { templateKey?: string; limit?: number } = {}
) {
  const scope = resolveTenantScope(scopeInput);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const templateKey = input.templateKey?.trim() || AGENT_PROMPT_TEMPLATE_KEY;
  const result = await db.query<AgentPromptTemplateRecord>(
    `SELECT id,
            tenant_key,
            workspace_key,
            template_key,
            template_version,
            status,
            template_body,
            template_hash,
            activated_at,
            retired_at,
            metadata,
            created_at,
            updated_at
     FROM ai_prompt_templates
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND template_key = $3
     ORDER BY
       CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
       COALESCE(activated_at, created_at) DESC
     LIMIT $4`,
    [scope.tenantKey, scope.workspaceKey, templateKey, limit]
  );
  return result.rows;
}

export async function getActiveAgentPromptTemplate(
  scopeInput?: TenantScopeInput,
  templateKey = AGENT_PROMPT_TEMPLATE_KEY
) {
  const scope = resolveTenantScope(scopeInput);
  const result = await db.query<AgentPromptTemplateRecord>(
    `SELECT id,
            tenant_key,
            workspace_key,
            template_key,
            template_version,
            status,
            template_body,
            template_hash,
            activated_at,
            retired_at,
            metadata,
            created_at,
            updated_at
     FROM ai_prompt_templates
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND template_key = $3
       AND status = 'active'
     ORDER BY activated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [scope.tenantKey, scope.workspaceKey, templateKey]
  );
  return result.rows[0] ?? null;
}

export async function createAgentPromptTemplateVersion(input: {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  templateKey?: string | null;
  templateVersion: string;
  templateBody: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}) {
  const scope = resolveTenantScope(input);
  const templateKey = input.templateKey?.trim() || AGENT_PROMPT_TEMPLATE_KEY;
  const templateHash = hashPromptTemplateBody(input.templateBody);
  const result = await db.query<AgentPromptTemplateRecord>(
    `INSERT INTO ai_prompt_templates (
       tenant_key,
       workspace_key,
       template_key,
       template_version,
       status,
       template_body,
       template_hash,
       metadata
     ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)
     RETURNING id,
               tenant_key,
               workspace_key,
               template_key,
               template_version,
               status,
               template_body,
               template_hash,
               activated_at,
               retired_at,
               metadata,
               created_at,
               updated_at`,
    [
      scope.tenantKey,
      scope.workspaceKey,
      templateKey,
      input.templateVersion.trim(),
      input.templateBody,
      templateHash,
      input.metadata ?? {}
    ]
  );
  return result.rows[0];
}

export async function activateAgentPromptTemplate(input: {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  templateId: string;
  actorUserId?: string | null;
  reason?: string | null;
  eventType?: "activated" | "rolled_back";
}) {
  const scope = resolveTenantScope(input);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<AgentPromptTemplateRecord>(
      `SELECT id,
              tenant_key,
              workspace_key,
              template_key,
              template_version,
              status,
              template_body,
              template_hash,
              activated_at,
              retired_at,
              metadata,
              created_at,
              updated_at
       FROM ai_prompt_templates
       WHERE id = $1
         AND tenant_key = $2
         AND workspace_key = $3
       FOR UPDATE`,
      [input.templateId, scope.tenantKey, scope.workspaceKey]
    );
    const template = selected.rows[0];
    if (!template) {
      await client.query("ROLLBACK");
      return null;
    }

    const retired = await client.query<{ id: string; template_version: string; status: string }>(
      `UPDATE ai_prompt_templates
       SET status = 'retired',
           retired_at = now(),
           updated_at = now()
       WHERE tenant_key = $1
         AND workspace_key = $2
         AND template_key = $3
         AND status = 'active'
         AND id <> $4
       RETURNING id, template_version, status`,
      [scope.tenantKey, scope.workspaceKey, template.template_key, template.id]
    );

    const activated = await client.query<AgentPromptTemplateRecord>(
      `UPDATE ai_prompt_templates
       SET status = 'active',
           activated_at = now(),
           retired_at = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING id,
                 tenant_key,
                 workspace_key,
                 template_key,
                 template_version,
                 status,
                 template_body,
                 template_hash,
                 activated_at,
                 retired_at,
                 metadata,
                 created_at,
                 updated_at`,
      [template.id]
    );

    await client.query(
      `INSERT INTO ai_prompt_template_events (
         tenant_key,
         workspace_key,
         template_id,
         template_key,
         template_version,
         event_type,
         actor_user_id,
         from_status,
         to_status,
         reason,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10)`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        template.id,
        template.template_key,
        template.template_version,
        input.eventType ?? "activated",
        input.actorUserId ?? null,
        template.status,
        input.reason?.slice(0, 500) ?? null,
        {
          retiredTemplateIds: retired.rows.map((row) => row.id),
          retiredTemplateVersions: retired.rows.map((row) => row.template_version)
        }
      ]
    );

    await client.query("COMMIT");
    return activated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rollbackAgentPromptTemplate(input: {
  tenantKey?: string | null;
  workspaceKey?: string | null;
  templateKey?: string | null;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  const scope = resolveTenantScope(input);
  const templateKey = input.templateKey?.trim() || AGENT_PROMPT_TEMPLATE_KEY;
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM ai_prompt_templates
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND template_key = $3
       AND status = 'retired'
     ORDER BY retired_at DESC NULLS LAST, activated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [scope.tenantKey, scope.workspaceKey, templateKey]
  );
  const targetId = result.rows[0]?.id;
  if (!targetId) {
    return null;
  }

  return activateAgentPromptTemplate({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    templateId: targetId,
    actorUserId: input.actorUserId,
    reason: input.reason,
    eventType: "rolled_back"
  });
}

export async function buildAgentPromptSandboxForRuntime(
  input: RuntimePromptSandboxInput
): Promise<AgentPromptSandbox> {
  try {
    const template = await getActiveAgentPromptTemplate({
      tenantKey: input.tenantKey,
      workspaceKey: input.workspaceKey
    });
    return buildAgentPromptSandbox({
      ...input,
      template: toSandboxTemplate(template)
    });
  } catch {
    return buildAgentPromptSandbox(input);
  }
}
