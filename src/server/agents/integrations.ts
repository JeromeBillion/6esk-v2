import { db } from "@/server/db";
import { getPlatformMailbox } from "@/server/mailboxes";
import { decryptSecret, encryptSecret } from "@/server/agents/secret";
import type { AgentPolicyMode } from "@/server/agents/policy-modes";
import { resolveTenantScope, type TenantScope, type TenantScopeInput } from "@/server/tenant-context";

export type AgentIntegration = {
  id: string;
  tenant_key: string;
  workspace_key?: string;
  tenant_scope?: TenantScope;
  name: string;
  provider: string;
  base_url: string;
  auth_type: string;
  shared_secret: string;
  status: string;
  policy_mode: AgentPolicyMode;
  scopes: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  policy: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type AgentIntegrationInput = {
  tenantKey?: string;
  name: string;
  provider?: string;
  baseUrl: string;
  authType?: string;
  sharedSecret: string;
  status?: string;
  policyMode?: AgentPolicyMode;
  scopes?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  policy?: Record<string, unknown>;
};

export async function listAgentIntegrations(scopeInput?: TenantScopeInput) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const result = await db.query<AgentIntegration>(
    `SELECT id, tenant_key, name, provider, base_url, auth_type, shared_secret, status,
            policy_mode, scopes, capabilities, policy, created_at, updated_at
     FROM agent_integrations
     ${scope ? "WHERE tenant_key = $1" : ""}
     ORDER BY created_at DESC`,
    scope ? [scope.tenantKey] : []
  );
  return result.rows.map((row) => ({
    ...row,
    shared_secret: decryptSecret(row.shared_secret)
  }));
}

export async function getAgentIntegrationById(id: string, scopeInput?: TenantScopeInput) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const result = await db.query<AgentIntegration>(
    `SELECT id, tenant_key, name, provider, base_url, auth_type, shared_secret, status,
            policy_mode, scopes, capabilities, policy, created_at, updated_at
     FROM agent_integrations
     WHERE id = $1
       ${scope ? "AND tenant_key = $2" : ""}`,
    scope ? [id, scope.tenantKey] : [id]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { ...row, shared_secret: decryptSecret(row.shared_secret) };
}

export async function getActiveAgentIntegration(scopeInput?: TenantScopeInput) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const result = await db.query<AgentIntegration>(
    `SELECT id, tenant_key, name, provider, base_url, auth_type, shared_secret, status,
            policy_mode, scopes, capabilities, policy, created_at, updated_at
     FROM agent_integrations
     WHERE status = 'active'
       ${scope ? "AND tenant_key = $1" : ""}
     ORDER BY created_at DESC
     LIMIT 1`,
    scope ? [scope.tenantKey] : []
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { ...row, shared_secret: decryptSecret(row.shared_secret) };
}

export async function createAgentIntegration(input: AgentIntegrationInput) {
  const tenantKey = input.tenantKey ?? "primary";
  const platformMailbox = await getPlatformMailbox({ tenantKey });
  const fallbackScopes = platformMailbox ? { mailbox_ids: [platformMailbox.id] } : {};
  const storedSecret = encryptSecret(input.sharedSecret);
  const result = await db.query<AgentIntegration>(
    `INSERT INTO agent_integrations (
      tenant_key, name, provider, base_url, auth_type, shared_secret,
      status, policy_mode, scopes, capabilities, policy
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11
    )
    RETURNING id, tenant_key, name, provider, base_url, auth_type, shared_secret, status,
              policy_mode, scopes, capabilities, policy, created_at, updated_at`,
    [
      tenantKey,
      input.name,
      input.provider ?? "elizaos",
      input.baseUrl,
      input.authType ?? "hmac",
      storedSecret,
      input.status ?? "active",
      input.policyMode ?? "hybrid_review",
      input.scopes ?? fallbackScopes,
      input.capabilities ?? {},
      input.policy ?? {}
    ]
  );
  const row = result.rows[0];
  return { ...row, shared_secret: decryptSecret(row.shared_secret) };
}

export async function updateAgentIntegration(
  id: string,
  updates: Partial<AgentIntegrationInput>,
  scopeInput?: TenantScopeInput
) {
  const scope = scopeInput ? resolveTenantScope(scopeInput) : null;
  const fields: string[] = [];
  const values: Array<string | Record<string, unknown>> = [];
  let index = 1;

  if (updates.name) {
    fields.push(`name = $${index++}`);
    values.push(updates.name);
  }

  if (updates.tenantKey) {
    fields.push(`tenant_key = $${index++}`);
    values.push(updates.tenantKey);
  }

  if (updates.baseUrl) {
    fields.push(`base_url = $${index++}`);
    values.push(updates.baseUrl);
  }

  if (updates.provider) {
    fields.push(`provider = $${index++}`);
    values.push(updates.provider);
  }

  if (updates.authType) {
    fields.push(`auth_type = $${index++}`);
    values.push(updates.authType);
  }

  if (updates.sharedSecret) {
    fields.push(`shared_secret = $${index++}`);
    values.push(encryptSecret(updates.sharedSecret));
  }

  if (updates.status) {
    fields.push(`status = $${index++}`);
    values.push(updates.status);
  }

  if (updates.policyMode) {
    fields.push(`policy_mode = $${index++}`);
    values.push(updates.policyMode);
  }

  if (updates.scopes) {
    fields.push(`scopes = $${index++}`);
    values.push(updates.scopes);
  }

  if (updates.capabilities) {
    fields.push(`capabilities = $${index++}`);
    values.push(updates.capabilities);
  }

  if (updates.policy) {
    fields.push(`policy = $${index++}`);
    values.push(updates.policy);
  }

  if (fields.length === 0) {
    return getAgentIntegrationById(id, scope);
  }

  fields.push("updated_at = now()");
  values.push(id);

  const result = await db.query<AgentIntegration>(
    `UPDATE agent_integrations
     SET ${fields.join(", ")}
     WHERE id = $${index}
       ${scope ? `AND tenant_key = $${index + 1}` : ""}
     RETURNING id, tenant_key, name, provider, base_url, auth_type, shared_secret, status,
               policy_mode, scopes, capabilities, policy, created_at, updated_at`,
    scope ? [...values, scope.tenantKey] :
    values
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { ...row, shared_secret: decryptSecret(row.shared_secret) };
}
