import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { db } from "@/server/db";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

const SECRET_AAD = Buffer.from("tenant-provider-webhook-secret.v2", "utf8");

type ProviderWebhookSecretScope = {
  tenantId: string;
  workspaceKey?: string | null;
};

type ProviderWebhookSecretRow = {
  id: string;
  tenant_id: string;
  workspace_key: string;
  provider: string;
  secret_type: string;
  provider_account_id: string | null;
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

export type ProviderWebhookSecretSummary = {
  id: string;
  tenantId: string;
  workspaceKey: string;
  provider: string;
  secretType: string;
  providerAccountId: string | null;
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

export type ActiveProviderWebhookSecret = {
  id: string;
  secret: string;
  source: "db" | "env";
};

export class ProviderWebhookSecretConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderWebhookSecretConfigurationError";
  }
}

function workspaceKeyFor(scope: ProviderWebhookSecretScope) {
  return scope.workspaceKey?.trim() || DEFAULT_WORKSPACE_KEY;
}

function readBooleanEnv(name: string) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return null;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function shouldRequireTenantProviderWebhookSecrets() {
  const configured = readBooleanEnv("TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS");
  if (configured !== null) {
    return configured;
  }
  return process.env.NODE_ENV === "production";
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_");
}

export function normalizeProviderWebhookSecretProvider(provider: string) {
  const normalized = normalizeToken(provider);
  return normalized || "unknown";
}

export function normalizeProviderWebhookSecretType(secretType: string) {
  const normalized = normalizeToken(secretType);
  return normalized || "webhook_secret";
}

function normalizeProviderAccountId(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function readEncryptionKey() {
  const raw =
    process.env.PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY?.trim() ||
    process.env.TENANT_INGRESS_SECRET_ENCRYPTION_KEY?.trim();
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
    throw new ProviderWebhookSecretConfigurationError(
      "PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY is required for persisted provider webhook secrets."
    );
  }
  return key;
}

export function generateProviderWebhookSecret() {
  return `tpws_${randomBytes(32).toString("base64url")}`;
}

export function fingerprintProviderWebhookSecret({
  provider,
  secretType,
  providerAccountId,
  secret
}: {
  provider: string;
  secretType: string;
  providerAccountId?: string | null;
  secret: string;
}) {
  const scope = [
    SECRET_AAD.toString("utf8"),
    normalizeProviderWebhookSecretProvider(provider),
    normalizeProviderWebhookSecretType(secretType),
    normalizeProviderAccountId(providerAccountId) ?? "*"
  ].join(":");
  return createHash("sha256").update(`${scope}:${secret}`).digest("hex");
}

function encryptProviderWebhookSecret({
  provider,
  secretType,
  providerAccountId,
  secret
}: {
  provider: string;
  secretType: string;
  providerAccountId?: string | null;
  secret: string;
}) {
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
    secret_fingerprint: fingerprintProviderWebhookSecret({
      provider,
      secretType,
      providerAccountId,
      secret
    })
  };
}

function decryptProviderWebhookSecret(row: ProviderWebhookSecretRow) {
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

function summarizeProviderWebhookSecret(row: ProviderWebhookSecretRow): ProviderWebhookSecretSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceKey: row.workspace_key,
    provider: row.provider,
    secretType: row.secret_type,
    providerAccountId: row.provider_account_id,
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

function parseEnvSecrets() {
  const raw = process.env.TENANT_PROVIDER_WEBHOOK_SECRETS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed)
      .map(([key, value]) => {
        const parts = key.split(":").map((part) => part.trim());
        const [tenantId, workspaceKey, provider, secretType, ...accountParts] = parts;
        const providerAccountId = accountParts.join(":") || null;
        const secret =
          typeof value === "string"
            ? value.trim()
            : value && typeof value === "object" && !Array.isArray(value)
              ? typeof (value as Record<string, unknown>).secret === "string"
                ? ((value as Record<string, unknown>).secret as string).trim()
                : ""
              : "";
        if (!tenantId || !workspaceKey || !provider || !secretType || !secret) {
          return null;
        }
        return {
          tenantId,
          workspaceKey,
          provider: normalizeProviderWebhookSecretProvider(provider),
          secretType: normalizeProviderWebhookSecretType(secretType),
          providerAccountId: normalizeProviderAccountId(providerAccountId),
          secret
        };
      })
      .filter(Boolean) as Array<{
      tenantId: string;
      workspaceKey: string;
      provider: string;
      secretType: string;
      providerAccountId: string | null;
      secret: string;
    }>;
  } catch {
    return [];
  }
}

function envSecretsFor(input: {
  scope: ProviderWebhookSecretScope;
  provider: string;
  secretType: string;
  providerAccountId?: string | null;
}) {
  const provider = normalizeProviderWebhookSecretProvider(input.provider);
  const secretType = normalizeProviderWebhookSecretType(input.secretType);
  const providerAccountId = normalizeProviderAccountId(input.providerAccountId);
  const workspaceKey = workspaceKeyFor(input.scope);
  return parseEnvSecrets()
    .filter((entry) => {
      const scopeMatches =
        entry.tenantId === input.scope.tenantId && entry.workspaceKey === workspaceKey;
      const providerMatches = entry.provider === provider && entry.secretType === secretType;
      const accountMatches =
        !entry.providerAccountId ||
        (providerAccountId !== null && entry.providerAccountId === providerAccountId);
      return scopeMatches && providerMatches && accountMatches;
    })
    .map((entry, index) => ({
      id: `env:${index}`,
      secret: entry.secret,
      source: "env" as const
    }));
}

export async function listProviderWebhookSecrets(scope: ProviderWebhookSecretScope) {
  const result = await db.query<ProviderWebhookSecretRow>(
    `SELECT id, tenant_id, workspace_key, provider, secret_type, provider_account_id, label,
            status, secret_ciphertext, secret_nonce, secret_tag, secret_fingerprint,
            created_by_user_id, rotated_from_secret_id, expires_at, last_used_at, created_at, updated_at
     FROM tenant_provider_webhook_secrets
     WHERE tenant_id = $1
       AND workspace_key = $2
     ORDER BY provider ASC, secret_type ASC, status = 'active' DESC, created_at DESC`,
    [scope.tenantId, workspaceKeyFor(scope)]
  );
  return result.rows.map(summarizeProviderWebhookSecret);
}

export async function listActiveProviderWebhookSecrets(input: {
  scope: ProviderWebhookSecretScope;
  provider: string;
  secretType: string;
  providerAccountId?: string | null;
  includeEnv?: boolean;
}): Promise<ActiveProviderWebhookSecret[]> {
  const provider = normalizeProviderWebhookSecretProvider(input.provider);
  const secretType = normalizeProviderWebhookSecretType(input.secretType);
  const providerAccountId = normalizeProviderAccountId(input.providerAccountId);
  const workspaceKey = workspaceKeyFor(input.scope);
  const result = await db.query<ProviderWebhookSecretRow>(
    `SELECT id, tenant_id, workspace_key, provider, secret_type, provider_account_id, label,
            status, secret_ciphertext, secret_nonce, secret_tag, secret_fingerprint,
            created_by_user_id, rotated_from_secret_id, expires_at, last_used_at, created_at, updated_at
     FROM tenant_provider_webhook_secrets
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND provider = $3
       AND secret_type = $4
       AND status IN ('active', 'retiring')
       AND (expires_at IS NULL OR expires_at > now())
       AND (provider_account_id IS NULL OR ($5::text IS NOT NULL AND provider_account_id = $5))
     ORDER BY status = 'active' DESC, provider_account_id IS NOT NULL DESC, created_at DESC`,
    [input.scope.tenantId, workspaceKey, provider, secretType, providerAccountId]
  );
  const dbSecrets = result.rows.map((row) => ({
    id: row.id,
    secret: decryptProviderWebhookSecret(row),
    source: "db" as const
  }));
  return input.includeEnv === false
    ? dbSecrets
    : [
        ...dbSecrets,
        ...envSecretsFor({
          scope: input.scope,
          provider,
          secretType,
          providerAccountId
        })
      ];
}

export async function rotateProviderWebhookSecret({
  scope,
  provider,
  secretType,
  providerAccountId,
  label,
  secret,
  actorUserId,
  retireExisting = true,
  expiresAt = null
}: {
  scope: ProviderWebhookSecretScope;
  provider: string;
  secretType: string;
  providerAccountId?: string | null;
  label?: string | null;
  secret?: string | null;
  actorUserId?: string | null;
  retireExisting?: boolean;
  expiresAt?: string | null;
}) {
  const workspaceKey = workspaceKeyFor(scope);
  const normalizedProvider = normalizeProviderWebhookSecretProvider(provider);
  const normalizedSecretType = normalizeProviderWebhookSecretType(secretType);
  const normalizedProviderAccountId = normalizeProviderAccountId(providerAccountId);
  const plaintextSecret = secret?.trim() || generateProviderWebhookSecret();
  const encrypted = encryptProviderWebhookSecret({
    provider: normalizedProvider,
    secretType: normalizedSecretType,
    providerAccountId: normalizedProviderAccountId,
    secret: plaintextSecret
  });
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    let rotatedFromSecretId: string | null = null;
    if (retireExisting) {
      const retired = await client.query<{ id: string }>(
        `UPDATE tenant_provider_webhook_secrets
         SET status = 'retiring',
             updated_at = now()
         WHERE tenant_id = $1
           AND workspace_key = $2
           AND provider = $3
           AND secret_type = $4
           AND COALESCE(provider_account_id, '') = COALESCE($5::text, '')
           AND status = 'active'
         RETURNING id`,
        [
          scope.tenantId,
          workspaceKey,
          normalizedProvider,
          normalizedSecretType,
          normalizedProviderAccountId
        ]
      );
      rotatedFromSecretId = retired.rows[0]?.id ?? null;
    }

    const result = await client.query<ProviderWebhookSecretRow>(
      `INSERT INTO tenant_provider_webhook_secrets (
         tenant_id, workspace_key, provider, secret_type, provider_account_id, label, status,
         secret_ciphertext, secret_nonce, secret_tag, secret_fingerprint,
         created_by_user_id, rotated_from_secret_id, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, tenant_id, workspace_key, provider, secret_type, provider_account_id,
                 label, status, secret_ciphertext, secret_nonce, secret_tag, secret_fingerprint,
                 created_by_user_id, rotated_from_secret_id, expires_at, last_used_at,
                 created_at, updated_at`,
      [
        scope.tenantId,
        workspaceKey,
        normalizedProvider,
        normalizedSecretType,
        normalizedProviderAccountId,
        label?.trim() || "Provider webhook secret",
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
      secret: summarizeProviderWebhookSecret(result.rows[0]),
      plaintextSecret,
      generated: !secret?.trim()
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeProviderWebhookSecret({
  scope,
  secretId
}: {
  scope: ProviderWebhookSecretScope;
  secretId: string;
}) {
  const result = await db.query<ProviderWebhookSecretRow>(
    `UPDATE tenant_provider_webhook_secrets
     SET status = 'revoked',
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3
     RETURNING id, tenant_id, workspace_key, provider, secret_type, provider_account_id,
               label, status, secret_ciphertext, secret_nonce, secret_tag, secret_fingerprint,
               created_by_user_id, rotated_from_secret_id, expires_at, last_used_at,
               created_at, updated_at`,
    [secretId, scope.tenantId, workspaceKeyFor(scope)]
  );
  return result.rows[0] ? summarizeProviderWebhookSecret(result.rows[0]) : null;
}

export async function markProviderWebhookSecretUsed(
  secretId: string,
  scope: ProviderWebhookSecretScope
) {
  if (secretId.startsWith("env:")) {
    return;
  }
  await db.query(
    `UPDATE tenant_provider_webhook_secrets
     SET last_used_at = now(),
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3`,
    [secretId, scope.tenantId, workspaceKeyFor(scope)]
  );
}
