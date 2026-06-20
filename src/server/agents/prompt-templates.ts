import { createHash } from "crypto";
import { db } from "@/server/db";
import {
  AGENT_PROMPT_TEMPLATE_KEY,
  buildAgentPromptSandbox,
  type AgentPromptSandbox,
  type AgentPromptSandboxMode,
  type AgentPromptTemplateSnapshot
} from "@/server/agents/prompt-sandbox";
import type { AgentOutputCustomerContext } from "@/server/agents/output-validator";

export type AgentPromptTemplateStatus = "draft" | "active" | "retired";

export type AgentPromptTemplateRecord = {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  template_key: string;
  template_version: string;
  status: AgentPromptTemplateStatus;
  template_body: Record<string, unknown>;
  template_hash: string;
  activated_at: Date | null;
  retired_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type PromptTemplateScope = {
  tenantId: string;
  workspaceId?: string | null;
};

type RuntimePromptSandboxInput = PromptTemplateScope & {
  runId?: string | null;
  mode: AgentPromptSandboxMode;
  eventType: string;
  payload: Record<string, unknown>;
  policy?: Record<string, unknown> | null;
  customerContext?: AgentOutputCustomerContext | null;
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

function normalizeTemplateKey(templateKey?: string | null) {
  return templateKey?.trim() || AGENT_PROMPT_TEMPLATE_KEY;
}

function normalizeTemplateVersion(templateVersion: string) {
  return templateVersion.trim().slice(0, 160);
}

function workspaceParam(workspaceId: string | null | undefined) {
  return workspaceId?.trim() || null;
}

function toTemplateSnapshot(template: AgentPromptTemplateRecord | null): AgentPromptTemplateSnapshot | null {
  if (!template) return null;
  return {
    templateKey: template.template_key,
    templateVersion: template.template_version,
    templateHash: template.template_hash,
    templateBody: template.template_body
  };
}

export function hashPromptTemplateBody(value: Record<string, unknown>) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export async function listAgentPromptTemplates(
  scope: PromptTemplateScope,
  input: { templateKey?: string | null; limit?: number | null } = {}
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const result = await db.query<AgentPromptTemplateRecord>(
    `SELECT id,
            tenant_id,
            workspace_id,
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
     FROM agent_prompt_templates
     WHERE tenant_id = $1
       AND (($2::uuid IS NULL AND workspace_id IS NULL) OR workspace_id = $2::uuid)
       AND template_key = $3
     ORDER BY
       CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
       COALESCE(activated_at, created_at) DESC
     LIMIT $4`,
    [scope.tenantId, workspaceParam(scope.workspaceId), normalizeTemplateKey(input.templateKey), limit]
  );
  return result.rows;
}

export async function getActiveAgentPromptTemplate(
  scope: PromptTemplateScope,
  templateKey = AGENT_PROMPT_TEMPLATE_KEY
) {
  const result = await db.query<AgentPromptTemplateRecord>(
    `SELECT id,
            tenant_id,
            workspace_id,
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
     FROM agent_prompt_templates
     WHERE tenant_id = $1
       AND (($2::uuid IS NULL AND workspace_id IS NULL) OR workspace_id = $2::uuid)
       AND template_key = $3
       AND status = 'active'
     ORDER BY activated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [scope.tenantId, workspaceParam(scope.workspaceId), normalizeTemplateKey(templateKey)]
  );
  return result.rows[0] ?? null;
}

export async function createAgentPromptTemplateVersion(input: PromptTemplateScope & {
  templateKey?: string | null;
  templateVersion: string;
  templateBody: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  const templateKey = normalizeTemplateKey(input.templateKey);
  const templateVersion = normalizeTemplateVersion(input.templateVersion);
  const templateHash = hashPromptTemplateBody(input.templateBody);
  const result = await db.query<AgentPromptTemplateRecord>(
    `INSERT INTO agent_prompt_templates (
       tenant_id,
       workspace_id,
       template_key,
       template_version,
       status,
       template_body,
       template_hash,
       metadata
     ) VALUES ($1, $2, $3, $4, 'draft', $5::jsonb, $6, $7::jsonb)
     RETURNING id,
               tenant_id,
               workspace_id,
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
      input.tenantId,
      workspaceParam(input.workspaceId),
      templateKey,
      templateVersion,
      JSON.stringify(input.templateBody),
      templateHash,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  const created = result.rows[0];
  await db.query(
    `INSERT INTO agent_prompt_template_events (
       tenant_id,
       workspace_id,
       template_id,
       template_key,
       template_version,
       event_type,
       actor_user_id,
       from_status,
       to_status,
       reason,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, 'created', $6, NULL, 'draft', $7, $8::jsonb)`,
    [
      input.tenantId,
      workspaceParam(input.workspaceId),
      created.id,
      templateKey,
      templateVersion,
      input.actorUserId ?? null,
      input.reason?.slice(0, 500) ?? null,
      JSON.stringify({ templateHash })
    ]
  );
  return created;
}

export async function activateAgentPromptTemplate(input: PromptTemplateScope & {
  templateId: string;
  actorUserId?: string | null;
  reason?: string | null;
  eventType?: "activated" | "rolled_back";
}) {
  const workspaceId = workspaceParam(input.workspaceId);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<AgentPromptTemplateRecord>(
      `SELECT id,
              tenant_id,
              workspace_id,
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
       FROM agent_prompt_templates
       WHERE tenant_id = $1
         AND id = $2
         AND (($3::uuid IS NULL AND workspace_id IS NULL) OR workspace_id = $3::uuid)
       FOR UPDATE`,
      [input.tenantId, input.templateId, workspaceId]
    );
    const template = selected.rows[0];
    if (!template) {
      await client.query("ROLLBACK");
      return null;
    }

    const retired = await client.query<{ id: string; template_version: string }>(
      `UPDATE agent_prompt_templates
       SET status = 'retired',
           retired_at = now(),
           updated_at = now()
       WHERE tenant_id = $1
         AND (($2::uuid IS NULL AND workspace_id IS NULL) OR workspace_id = $2::uuid)
         AND template_key = $3
         AND status = 'active'
         AND id <> $4
       RETURNING id, template_version`,
      [input.tenantId, workspaceId, template.template_key, template.id]
    );

    const activated = await client.query<AgentPromptTemplateRecord>(
      `UPDATE agent_prompt_templates
       SET status = 'active',
           activated_at = now(),
           retired_at = NULL,
           updated_at = now()
       WHERE tenant_id = $1
         AND id = $2
       RETURNING id,
                 tenant_id,
                 workspace_id,
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
      [input.tenantId, template.id]
    );

    await client.query(
      `INSERT INTO agent_prompt_template_events (
         tenant_id,
         workspace_id,
         template_id,
         template_key,
         template_version,
         event_type,
         actor_user_id,
         from_status,
         to_status,
         reason,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10::jsonb)`,
      [
        input.tenantId,
        workspaceId,
        template.id,
        template.template_key,
        template.template_version,
        input.eventType ?? "activated",
        input.actorUserId ?? null,
        template.status,
        input.reason?.slice(0, 500) ?? null,
        JSON.stringify({
          retiredTemplateIds: retired.rows.map((row) => row.id),
          retiredTemplateVersions: retired.rows.map((row) => row.template_version)
        })
      ]
    );

    await client.query("COMMIT");
    return activated.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rollbackAgentPromptTemplate(input: PromptTemplateScope & {
  templateKey?: string | null;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  const workspaceId = workspaceParam(input.workspaceId);
  const templateKey = normalizeTemplateKey(input.templateKey);
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM agent_prompt_templates
     WHERE tenant_id = $1
       AND (($2::uuid IS NULL AND workspace_id IS NULL) OR workspace_id = $2::uuid)
       AND template_key = $3
       AND status = 'retired'
     ORDER BY retired_at DESC NULLS LAST, activated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [input.tenantId, workspaceId, templateKey]
  );
  const targetId = result.rows[0]?.id;
  if (!targetId) return null;

  return activateAgentPromptTemplate({
    tenantId: input.tenantId,
    workspaceId,
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
    const template = await getActiveAgentPromptTemplate(input);
    return buildAgentPromptSandbox({
      ...input,
      template: toTemplateSnapshot(template)
    });
  } catch {
    return buildAgentPromptSandbox(input);
  }
}
