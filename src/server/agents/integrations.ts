import { db } from "@/server/db";
import { getPlatformMailbox } from "@/server/mailboxes";
import { decryptSecret, encryptSecret } from "@/server/agents/secret";

export type AgentPolicyMode = "draft_only" | "auto_send";

export type AgentIntegration = {
  id: string;
  tenant_id: string;
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
  tenantId?: string | null;
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

function normalizeTenantId(tenantId: string | null | undefined) {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function requireTenantId(tenantId: string | null | undefined, operation: string) {
  const normalized = normalizeTenantId(tenantId);
  if (!normalized) {
    throw new Error(`${operation} requires tenantId`);
  }
  return normalized;
}

export async function listAgentIntegrations(tenantId?: string | null) {
  const scopedTenantId = normalizeTenantId(tenantId);
  if (!scopedTenantId) {
    return [];
  }

  const result = await db.query<AgentIntegration>(
    `SELECT id, tenant_id, name, provider, base_url, auth_type, shared_secret, status,
            policy_mode, scopes, capabilities, policy, created_at, updated_at
     FROM agent_integrations
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [scopedTenantId]
  );
  return result.rows.map((row) => ({
    ...row,
    shared_secret: decryptSecret(row.shared_secret)
  }));
}

export async function getAgentIntegrationById(id: string, tenantId?: string | null) {
  const scopedTenantId = normalizeTenantId(tenantId);
  if (!scopedTenantId) {
    return null;
  }

  const result = await db.query<AgentIntegration>(
    `SELECT id, tenant_id, name, provider, base_url, auth_type, shared_secret, status,
            policy_mode, scopes, capabilities, policy, created_at, updated_at
     FROM agent_integrations
     WHERE id = $1
       AND tenant_id = $2`,
    [id, scopedTenantId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { ...row, shared_secret: decryptSecret(row.shared_secret) };
}

export async function getActiveAgentIntegration(tenantId?: string | null) {
  const scopedTenantId = normalizeTenantId(tenantId);
  if (!scopedTenantId) {
    return null;
  }

  const result = await db.query<AgentIntegration>(
    `SELECT id, tenant_id, name, provider, base_url, auth_type, shared_secret, status,
            policy_mode, scopes, capabilities, policy, created_at, updated_at
     FROM agent_integrations
     WHERE status = 'active'
       AND tenant_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [scopedTenantId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { ...row, shared_secret: decryptSecret(row.shared_secret) };
}

export async function createAgentIntegration(input: AgentIntegrationInput) {
  const scopedTenantId = requireTenantId(input.tenantId, "Create agent integration");
  const platformMailbox = await getPlatformMailbox(scopedTenantId);
  const fallbackScopes = platformMailbox ? { mailbox_ids: [platformMailbox.id] } : {};
  const storedSecret = encryptSecret(input.sharedSecret);
  const result = await db.query<AgentIntegration>(
    `INSERT INTO agent_integrations (
      tenant_id, name, provider, base_url, auth_type, shared_secret,
      status, policy_mode, scopes, capabilities, policy
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11
    )
    RETURNING id, tenant_id, name, provider, base_url, auth_type, shared_secret, status,
              policy_mode, scopes, capabilities, policy, created_at, updated_at`,
    [
      scopedTenantId,
      input.name,
      input.provider ?? "elizaos",
      input.baseUrl,
      input.authType ?? "hmac",
      storedSecret,
      input.status ?? "active",
      input.policyMode ?? "draft_only",
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
  tenantId?: string | null
) {
  const scopedTenantId = normalizeTenantId(tenantId);
  if (!scopedTenantId) {
    return null;
  }

  const fields: string[] = [];
  const values: Array<string | Record<string, unknown>> = [];
  let index = 1;

  if (updates.name) {
    fields.push(`name = $${index++}`);
    values.push(updates.name);
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
    return getAgentIntegrationById(id, scopedTenantId);
  }

  fields.push("updated_at = now()");
  values.push(id);
  const idParam = index++;
  values.push(scopedTenantId);
  const tenantParam = index++;

  const result = await db.query<AgentIntegration>(
    `UPDATE agent_integrations
     SET ${fields.join(", ")}
     WHERE id = $${idParam}
       AND tenant_id = $${tenantParam}
     RETURNING id, tenant_id, name, provider, base_url, auth_type, shared_secret, status,
               policy_mode, scopes, capabilities, policy, created_at, updated_at`,
    values
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { ...row, shared_secret: decryptSecret(row.shared_secret) };
}
