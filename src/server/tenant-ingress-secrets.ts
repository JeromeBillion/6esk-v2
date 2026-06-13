import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/server/db";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

const SECRET_AAD = Buffer.from("tenant-ingress-secret.v2", "utf8");

type TenantIngressSecretScope = {
  tenantId: string;
  workspaceKey?: string | null;
};

type TenantIngressSigningSecretRow = {
  id: string;
  tenant_id: string;
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
  tenantId: string;
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

export class TenantIngressVerificationError extends Error {
  code: string;
  status: number;

  constructor({
    code,
    message,
    status = 401
  }: {
    code: string;
    message: string;
    status?: number;
  }) {
    super(message);
    this.name = "TenantIngressVerificationError";
    this.code = code;
    this.status = status;
  }
}

export type TenantIngressRequestScope = {
  tenantId: string;
  workspaceKey: string;
  matchedSecretId: string | null;
  authMode: "tenant_ingress_secret" | "global_shared_secret";
};

function workspaceKeyFor(scope: TenantIngressSecretScope) {
  return scope.workspaceKey?.trim() || DEFAULT_WORKSPACE_KEY;
}

function readBooleanEnv(key: string) {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return null;
}

export function shouldRequireTenantIngressSigningSecrets() {
  const configured = readBooleanEnv("TENANT_INGRESS_REQUIRE_SECRETS");
  if (configured !== null) return configured;
  return process.env.NODE_ENV === "production";
}

export function isTenantIngressVerificationError(
  error: unknown
): error is TenantIngressVerificationError {
  return error instanceof TenantIngressVerificationError;
}

function timingSafeStringEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readHeader(request: Request, ...names: string[]) {
  for (const name of names) {
    const value = request.headers.get(name)?.trim();
    if (value) return value;
  }
  return null;
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
    tenantId: row.tenant_id,
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

export async function listTenantIngressSigningSecrets(scope: TenantIngressSecretScope) {
  const result = await db.query<TenantIngressSigningSecretRow>(
    `SELECT id, tenant_id, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
            secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at,
            last_used_at, created_at, updated_at
     FROM tenant_ingress_signing_secrets
     WHERE tenant_id = $1
       AND workspace_key = $2
     ORDER BY status = 'active' DESC, status = 'retiring' DESC, created_at DESC`,
    [scope.tenantId, workspaceKeyFor(scope)]
  );
  return result.rows.map(summarizeTenantIngressSigningSecret);
}

export async function listActiveTenantIngressSigningSecrets(
  scope: TenantIngressSecretScope
): Promise<ActiveTenantIngressSigningSecret[]> {
  const result = await db.query<TenantIngressSigningSecretRow>(
    `SELECT id, tenant_id, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
            secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at,
            last_used_at, created_at, updated_at
     FROM tenant_ingress_signing_secrets
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND status IN ('active', 'retiring')
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY status = 'active' DESC, created_at DESC`,
    [scope.tenantId, workspaceKeyFor(scope)]
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
  scope: TenantIngressSecretScope;
  label?: string | null;
  actorUserId?: string | null;
  retireExisting?: boolean;
  expiresAt?: string | null;
}) {
  const workspaceKey = workspaceKeyFor(scope);
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
         WHERE tenant_id = $1
           AND workspace_key = $2
           AND status = 'active'
         RETURNING id`,
        [scope.tenantId, workspaceKey]
      );
      rotatedFromSecretId = retired.rows[0]?.id ?? null;
    }

    const result = await client.query<TenantIngressSigningSecretRow>(
      `INSERT INTO tenant_ingress_signing_secrets (
         tenant_id, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
         secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at
       )
       VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, tenant_id, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
                 secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at,
                 last_used_at, created_at, updated_at`,
      [
        scope.tenantId,
        workspaceKey,
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
  scope: TenantIngressSecretScope;
  secretId: string;
}) {
  const result = await db.query<TenantIngressSigningSecretRow>(
    `UPDATE tenant_ingress_signing_secrets
     SET status = 'revoked',
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3
     RETURNING id, tenant_id, workspace_key, label, status, secret_ciphertext, secret_nonce, secret_tag,
               secret_fingerprint, created_by_user_id, rotated_from_secret_id, expires_at,
               last_used_at, created_at, updated_at`,
    [secretId, scope.tenantId, workspaceKeyFor(scope)]
  );
  return result.rows[0] ? summarizeTenantIngressSigningSecret(result.rows[0]) : null;
}

export async function markTenantIngressSigningSecretUsed(
  secretId: string,
  scope: TenantIngressSecretScope
) {
  await db.query(
    `UPDATE tenant_ingress_signing_secrets
     SET last_used_at = now(),
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3`,
    [secretId, scope.tenantId, workspaceKeyFor(scope)]
  );
}

export async function resolveTenantIngressRequestScope(
  request: Request,
  options: {
    providedSecret?: string | null;
    fallbackGlobalSecret?: string | null;
    fallbackTenantId?: string | null;
    fallbackWorkspaceKey?: string | null;
  } = {}
): Promise<TenantIngressRequestScope> {
  const providedSecret =
    options.providedSecret?.trim() || readHeader(request, "x-6esk-secret", "x-ingress-secret");
  if (!providedSecret) {
    throw new TenantIngressVerificationError({
      code: "tenant_ingress_secret_required",
      message: "Tenant ingress secret is required"
    });
  }

  const tenantId = readHeader(request, "x-6esk-tenant-id", "x-6esk-tenant");
  const workspaceKey =
    readHeader(request, "x-6esk-workspace-key", "x-6esk-workspace") ||
    options.fallbackWorkspaceKey?.trim() ||
    DEFAULT_WORKSPACE_KEY;

  if (tenantId) {
    const secrets = await listActiveTenantIngressSigningSecrets({ tenantId, workspaceKey });
    const matched = secrets.find((secret) => timingSafeStringEqual(providedSecret, secret.secret));
    if (!matched) {
      throw new TenantIngressVerificationError({
        code: "tenant_ingress_secret_invalid",
        message: "Tenant ingress secret is invalid"
      });
    }
    await markTenantIngressSigningSecretUsed(matched.id, { tenantId, workspaceKey });
    return {
      tenantId,
      workspaceKey,
      matchedSecretId: matched.id,
      authMode: "tenant_ingress_secret"
    };
  }

  if (shouldRequireTenantIngressSigningSecrets()) {
    throw new TenantIngressVerificationError({
      code: "tenant_ingress_tenant_required",
      message: "Tenant ingress tenant header is required",
      status: 400
    });
  }

  const fallbackSecret = options.fallbackGlobalSecret?.trim();
  const fallbackTenantId = options.fallbackTenantId?.trim();
  if (!fallbackSecret || !fallbackTenantId || !timingSafeStringEqual(providedSecret, fallbackSecret)) {
    throw new TenantIngressVerificationError({
      code: "tenant_ingress_secret_invalid",
      message: "Tenant ingress secret is invalid"
    });
  }

  return {
    tenantId: fallbackTenantId,
    workspaceKey,
    matchedSecretId: null,
    authMode: "global_shared_secret"
  };
}
