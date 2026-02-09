import { db } from "@/server/db";
import { getPlatformMailbox } from "@/server/mailboxes";

export type AgentPolicyMode = "draft_only" | "auto_send";

export type AgentIntegration = {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  auth_type: string;
  shared_secret: string;
  status: string;
  policy_mode: AgentPolicyMode;
  scopes: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type AgentIntegrationInput = {
  name: string;
  provider?: string;
  baseUrl: string;
  authType?: string;
  sharedSecret: string;
  status?: string;
  policyMode?: AgentPolicyMode;
  scopes?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
};

export async function listAgentIntegrations() {
  const result = await db.query<AgentIntegration>(
    `SELECT id, name, provider, base_url, auth_type, shared_secret, status,
            policy_mode, scopes, capabilities, created_at, updated_at
     FROM agent_integrations
     ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function getAgentIntegrationById(id: string) {
  const result = await db.query<AgentIntegration>(
    `SELECT id, name, provider, base_url, auth_type, shared_secret, status,
            policy_mode, scopes, capabilities, created_at, updated_at
     FROM agent_integrations
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getActiveAgentIntegration() {
  const result = await db.query<AgentIntegration>(
    `SELECT id, name, provider, base_url, auth_type, shared_secret, status,
            policy_mode, scopes, capabilities, created_at, updated_at
     FROM agent_integrations
     WHERE status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`
  );
  return result.rows[0] ?? null;
}

export async function createAgentIntegration(input: AgentIntegrationInput) {
  const platformMailbox = await getPlatformMailbox();
  const fallbackScopes = platformMailbox ? { mailbox_ids: [platformMailbox.id] } : {};
  const result = await db.query<AgentIntegration>(
    `INSERT INTO agent_integrations (
      name, provider, base_url, auth_type, shared_secret,
      status, policy_mode, scopes, capabilities
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9
    )
    RETURNING id, name, provider, base_url, auth_type, shared_secret, status,
              policy_mode, scopes, capabilities, created_at, updated_at`,
    [
      input.name,
      input.provider ?? "elizaos",
      input.baseUrl,
      input.authType ?? "hmac",
      input.sharedSecret,
      input.status ?? "active",
      input.policyMode ?? "draft_only",
      input.scopes ?? fallbackScopes,
      input.capabilities ?? {}
    ]
  );
  return result.rows[0];
}

export async function updateAgentIntegration(
  id: string,
  updates: Partial<AgentIntegrationInput>
) {
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
    values.push(updates.sharedSecret);
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

  if (fields.length === 0) {
    return getAgentIntegrationById(id);
  }

  fields.push("updated_at = now()");
  values.push(id);

  const result = await db.query<AgentIntegration>(
    `UPDATE agent_integrations
     SET ${fields.join(", ")}
     WHERE id = $${index}
     RETURNING id, name, provider, base_url, auth_type, shared_secret, status,
               policy_mode, scopes, capabilities, created_at, updated_at`,
    values
  );

  return result.rows[0] ?? null;
}
