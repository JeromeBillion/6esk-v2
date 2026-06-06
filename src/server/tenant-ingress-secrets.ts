import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { db } from "@/server/db";
import type { TenantScope } from "@/server/tenant-context";

const SECRET_AAD = Buffer.from("tenant-ingress-secret.v1", "utf8");

type TenantIngressSigningSecretRow = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  label: string;
  status: "active" | "retiring" | "revoked" | string;
  secret_ciphertext: string;
  secret_nonce: string;
  secret_tag: string;
  secret_fingerprint: string;
  created_by_user_id: string | null;
  rotated_from_secret_id: string | null;
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

export type TenantIngressSigningSecretSummary = {
  id: string;
  tenantKey: string;
  workspaceKey: string;
  label: string;
  status: string;
  fingerprint: string;
  createdByUserId: string | null;
  rotatedFromSecretId: string | null;
  expiresAt: Date | string | null;
  lastUsedAt: Date | string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

export type ActiveTenantIngressSigningSecret = {
  id: string;
  secret: string;
};

export class TenantIngressSecretConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIngressSecretConfigurationError";
  }
}

function readEncryptionKey() {
  const raw = process.env.TENANT_INGRESS_SECRET_ENCRYPTION_KEY?.trim();
  if (!raw) {
    return null;
  }
  if (raw.startsWith("base64:")) {
    const decoded = Buffer.from(raw.slice("base64:".length), "base64");
    return decoded.length === 32 ? decoded : createHash("sha256").update(decoded).digest();
  }
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

function requireEncryptionKey() {
  const key = readEncryptionKey();
  if (!key) {
    throw new TenantIngressSecretConfigurationError(
      "TENANT_INGRESS_SECRET_ENCRYPTION_KEY is required for persisted tenant ingress secrets."
    );
  }
  return key;
}

export function generateTenantIngressSigningSecret() {
  return `tigs_${randomBytes(32).toString("base64url")}`;
}

export function fingerprintTenantIngressSigningSecret(secret: string) {
  return createHash("sha256").update(`${SECRET_AAD.toString("utf8")}:${secret}`).digest("hex");
}

function encryptTenantIngressSigningSecret(secret: string) {
  const key = requireEncryptionKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(SECRET_AAD);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    secret_ciphertext: ciphertext.toString("base64"),
    secret_nonce: nonce.toString("base64"),
    secret_tag: tag.toString("base64"),
    secret_fingerprint: fingerprintTenantIngressSigningSecret(secret)
  };
}

function decryptTenantIngressSigningSecret(row: TenantIngressSigningSecretRow) {
  const key = requireEncryptionKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(row.secret_nonce, "base64")
  );
  decipher.setAAD(SECRET_AAD);
  decipher.setAuthTag(Buffer.from(row.secret_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.secret_ciphertext, "base64")),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}

function summarizeTenantIngressSigningSecret(
  row: TenantIngressSigningSecretRow
): TenantIngressSigningSecretSummary {
  return {
    id: row.id,
    tenantKey: row.tenant_key,
    workspaceKey: row.workspace_key,
    label: row.label,
    status: row.status,
    fingerprint: row.secret_fingerprint.slice(0, 16),
    createdByUserId: row.created_by_user_id,
    rotatedFromSecretId: row.rotated_from_secret_id,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listTenantIngressSigningSecrets(scope: TenantScope) {
  const result = await db.query<TenantIngressSigningSecretRow>(
    `SELECT id, tenant_key, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
            secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at,
            last_used_at, created_at, updated_at
     FROM tenant_ingress_signing_secrets
     WHERE tenant_key = $1
       AND workspace_key = $2
     ORDER BY status = 'active' DESC, status = 'retiring' DESC, created_at DESC`,
    [scope.tenantKey, scope.workspaceKey]
  );
  return result.rows.map(summarizeTenantIngressSigningSecret);
}

export async function listActiveTenantIngressSigningSecrets(
  scope: TenantScope
): Promise<ActiveTenantIngressSigningSecret[]> {
  const result = await db.query<TenantIngressSigningSecretRow>(
    `SELECT id, tenant_key, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
            secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at,
            last_used_at, created_at, updated_at
     FROM tenant_ingress_signing_secrets
     WHERE tenant_key = $1
       AND workspace_key = $2
       AND status IN ('active', 'retiring')
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY status = 'active' DESC, created_at DESC`,
    [scope.tenantKey, scope.workspaceKey]
  );
  return result.rows.map((row) => ({
    id: row.id,
    secret: decryptTenantIngressSigningSecret(row)
  }));
}

export async function rotateTenantIngressSigningSecret({
  scope,
  label,
  actorUserId,
  retireExisting = true,
  expiresAt = null
}: {
  scope: TenantScope;
  label?: string | null;
  actorUserId?: string | null;
  retireExisting?: boolean;
  expiresAt?: string | null;
}) {
  const plaintextSecret = generateTenantIngressSigningSecret();
  const encrypted = encryptTenantIngressSigningSecret(plaintextSecret);
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    let rotatedFromSecretId: string | null = null;

    if (retireExisting) {
      const retired = await client.query<{ id: string }>(
        `UPDATE tenant_ingress_signing_secrets
         SET status = 'retiring',
             updated_at = now()
         WHERE tenant_key = $1
           AND workspace_key = $2
           AND status = 'active'
         RETURNING id`,
        [scope.tenantKey, scope.workspaceKey]
      );
      rotatedFromSecretId = retired.rows[0]?.id ?? null;
    }

    const result = await client.query<TenantIngressSigningSecretRow>(
      `INSERT INTO tenant_ingress_signing_secrets (
         tenant_key, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
         secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at
       )
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, tenant_key, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
                 secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at,
                 last_used_at, created_at, updated_at`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        label?.trim() || "Machine ingress",
        encrypted.secret_ciphertext,
        encrypted.secret_nonce,
        encrypted.secret_tag,
        encrypted.secret_fingerprint,
        actorUserId ?? null,
        rotatedFromSecretId,
        expiresAt
      ]
    );

    await client.query("COMMIT");
    return {
      secret: summarizeTenantIngressSigningSecret(result.rows[0]),
      plaintextSecret
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeTenantIngressSigningSecret({
  scope,
  secretId
}: {
  scope: TenantScope;
  secretId: string;
}) {
  const result = await db.query<TenantIngressSigningSecretRow>(
    `UPDATE tenant_ingress_signing_secrets
     SET status = 'revoked',
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
     RETURNING id, tenant_key, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
               secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at,
               last_used_at, created_at, updated_at`,
    [secretId, scope.tenantKey, scope.workspaceKey]
  );
  return result.rows[0] ? summarizeTenantIngressSigningSecret(result.rows[0]) : null;
}

export async function markTenantIngressSigningSecretUsed(secretId: string, scope: TenantScope) {
  await db.query(
    `UPDATE tenant_ingress_signing_secrets
     SET last_used_at = now(),
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3`,
    [secretId, scope.tenantKey, scope.workspaceKey]
  );
}
