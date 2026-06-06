import { db } from "@/server/db";

export type OAuthConnection = {
  id: string;
  tenant_id: string;
  provider: "google" | "microsoft" | "resend" | "imap" | "zoho";
  email_address: string;
  token_expires_at: Date | null;
  provider_account_id: string | null;
  provider_tenant_id: string | null;
  scopes: string[];
  sync_cursor: string | null;
  last_sync_at: Date | null;
  last_sync_error: string | null;
  sync_status: "pending" | "active" | "paused" | "revoked" | "error";
  connected_by: string | null;
  created_at: Date;
  updated_at: Date;
  revoked_at: Date | null;
};

export async function createOAuthConnection(params: {
  tenantId: string;
  provider: "google" | "microsoft" | "resend" | "imap" | "zoho";
  emailAddress: string;
  accessTokenEnc: Buffer;
  refreshTokenEnc: Buffer;
  tokenIv: Buffer;
  expiresAt: Date | null;
  scopes: string[];
  providerAccountId?: string | null;
  providerTenantId?: string | null;
  connectedBy?: string | null;
}): Promise<{ id: string }> {
  const result = await db.query(
    `INSERT INTO oauth_connections (
      tenant_id, provider, email_address,
      access_token_enc, refresh_token_enc, token_iv, token_expires_at,
      provider_account_id, provider_tenant_id, scopes, connected_by, sync_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
    ON CONFLICT (tenant_id, provider, email_address) DO UPDATE SET
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      token_iv = EXCLUDED.token_iv,
      token_expires_at = EXCLUDED.token_expires_at,
      scopes = EXCLUDED.scopes,
      sync_status = 'active',
      updated_at = now(),
      revoked_at = NULL
    RETURNING id`,
    [
      params.tenantId,
      params.provider,
      params.emailAddress,
      params.accessTokenEnc,
      params.refreshTokenEnc,
      params.tokenIv,
      params.expiresAt ?? null,
      params.providerAccountId ?? null,
      params.providerTenantId ?? null,
      params.scopes,
      params.connectedBy ?? null
    ]
  );

  return { id: result.rows[0].id };
}

export async function getActiveConnection(
  tenantId: string,
  emailAddress: string
): Promise<OAuthConnection | null> {
  const result = await db.query(
    `SELECT
      id, tenant_id, provider, email_address, token_expires_at,
      provider_account_id, provider_tenant_id, scopes,
      sync_cursor, last_sync_at, last_sync_error, sync_status,
      connected_by, created_at, updated_at, revoked_at
    FROM oauth_connections
    WHERE tenant_id = $1 AND email_address = $2 AND sync_status = 'active'
    LIMIT 1`,
    [tenantId, emailAddress]
  );
  return result.rows[0] ?? null;
}

export async function getActiveConnectionForMailbox(
  emailAddress: string
): Promise<OAuthConnection | null> {
  const result = await db.query(
    `SELECT
      c.id, c.tenant_id, c.provider, c.email_address, c.token_expires_at,
      c.provider_account_id, c.provider_tenant_id, c.scopes,
      c.sync_cursor, c.last_sync_at, c.last_sync_error, c.sync_status,
      c.connected_by, c.created_at, c.updated_at, c.revoked_at
    FROM mailboxes m
    JOIN oauth_connections c ON m.oauth_connection_id = c.id
    WHERE m.address = $1 AND c.sync_status = 'active'
    LIMIT 1`,
    [emailAddress.toLowerCase()]
  );
  return result.rows[0] ?? null;
}

export async function getConnectionTokens(connectionId: string): Promise<{
  accessTokenEnc: Buffer;
  refreshTokenEnc: Buffer;
  tokenIv: Buffer;
} | null> {
  const result = await db.query(
    `SELECT access_token_enc, refresh_token_enc, token_iv
     FROM oauth_connections
     WHERE id = $1`,
    [connectionId]
  );
  if (!result.rows[0]) return null;
  return {
    accessTokenEnc: result.rows[0].access_token_enc,
    refreshTokenEnc: result.rows[0].refresh_token_enc,
    tokenIv: result.rows[0].token_iv
  };
}

export async function updateConnectionTokens(
  connectionId: string,
  accessTokenEnc: Buffer,
  refreshTokenEnc: Buffer,
  tokenIv: Buffer,
  expiresAt: Date | null
) {
  await db.query(
    `UPDATE oauth_connections
     SET access_token_enc = $2,
         refresh_token_enc = $3,
         token_iv = $4,
         token_expires_at = $5,
         updated_at = now()
     WHERE id = $1`,
    [connectionId, accessTokenEnc, refreshTokenEnc, tokenIv, expiresAt]
  );
}

export async function revokeConnection(connectionId: string) {
  await db.query(
    `UPDATE oauth_connections
     SET sync_status = 'revoked', revoked_at = now(), updated_at = now()
     WHERE id = $1`,
    [connectionId]
  );
}

export async function getTenantOAuthConnections(tenantId: string): Promise<
  Omit<OAuthConnection, "accessTokenEnc" | "refreshTokenEnc" | "tokenIv">[]
> {
  const result = await db.query(
    `SELECT
      id, tenant_id, provider, email_address, token_expires_at,
      provider_account_id, provider_tenant_id, scopes,
      sync_cursor, last_sync_at, last_sync_error, sync_status,
      connected_by, created_at, updated_at, revoked_at
    FROM oauth_connections
    WHERE tenant_id = $1
    ORDER BY created_at DESC`,
    [tenantId]
  );
  return result.rows;
}
