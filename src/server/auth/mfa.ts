import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "crypto";
import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_SUPPORT_ROLE,
  LEAD_ADMIN_ROLE,
  TENANT_ADMIN_ROLE
} from "@/server/auth/roles";
import type { SessionUser } from "@/server/auth/session";
import { getTenantSecurityPolicy } from "@/server/auth/tenant-security-policy";
import { db } from "@/server/db";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

type ScopedUser = Pick<SessionUser, "id" | "email" | "tenant_id" | "role_name">;

type MfaScope = {
  tenantId: string;
  workspaceKey: string;
  userId: string;
};

export type MfaFactorRecord = {
  id: string;
  factor_type: "totp" | "webauthn" | "recovery_code" | string;
  label: string | null;
  last_used_at: string | Date | null;
  created_at: string | Date;
  disabled_at: string | Date | null;
};

export type MfaStatus = {
  required: boolean;
  factors: MfaFactorRecord[];
};

export type MfaEnrollmentStart = {
  enrollmentToken: string;
  otpauthUrl: string;
  secretBase32: string;
  expiresAt: Date;
};

export type MfaChallengeStart = {
  challengeToken: string;
  expiresAt: Date;
};

export type MfaChallengeVerification =
  | {
      ok: true;
      userId: string;
      tenantId: string;
      workspaceKey: string;
      factorId: string;
      challengeId: string;
    }
  | {
      ok: false;
      code:
        | "invalid_challenge"
        | "expired_challenge"
        | "too_many_attempts"
        | "invalid_code"
        | "mfa_not_configured";
      tenantId?: string;
      workspaceKey?: string;
      userId?: string;
    };

const ENCRYPTION_PREFIX = "enc:v1";
const MFA_SECRET_AAD_PREFIX = "auth-mfa-secret.v2";
const MFA_TOKEN_PREFIX = "auth-mfa-token.v2";
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const MFA_CHALLENGE_TTL_MINUTES = 10;
const MFA_ENROLLMENT_TTL_MINUTES = 10;
const MFA_MAX_CHALLENGE_ATTEMPTS = 5;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function readBoolean(value: string | undefined | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function resolveScope(user: Pick<ScopedUser, "id" | "tenant_id">): MfaScope {
  return {
    tenantId: user.tenant_id,
    workspaceKey: DEFAULT_WORKSPACE_KEY,
    userId: user.id
  };
}

function expiresInMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function readMfaEncryptionKey() {
  const raw =
    process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY?.trim() ||
    (process.env.NODE_ENV !== "production" ? process.env.SESSION_SECRET?.trim() : "");

  if (!raw || raw.length < 16) {
    throw new Error("AUTH_MFA_SECRET_ENCRYPTION_KEY is required for MFA secret encryption.");
  }

  return createHash("sha256").update(raw).digest();
}

function encryptionAad(scope: MfaScope) {
  return Buffer.from(
    `${MFA_SECRET_AAD_PREFIX}:${scope.tenantId}:${scope.workspaceKey}:${scope.userId}`
  );
}

export function encryptMfaSecret(secretBase32: string, scope: MfaScope) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readMfaEncryptionKey(), iv);
  cipher.setAAD(encryptionAad(scope));
  const ciphertext = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTION_PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

export function decryptMfaSecret(encrypted: string, scope: MfaScope) {
  const parts = encrypted.split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== ENCRYPTION_PREFIX) {
    throw new Error("Unsupported MFA secret format.");
  }
  const [, , ivRaw, tagRaw, ciphertextRaw] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    readMfaEncryptionKey(),
    Buffer.from(ivRaw, "base64url")
  );
  decipher.setAAD(encryptionAad(scope));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function tokenHash(token: string) {
  const secret = process.env.SESSION_SECRET?.trim() || process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY?.trim() || "dev";
  return createHmac("sha256", secret).update(`${MFA_TOKEN_PREFIX}:${token}`).digest("hex");
}

function safeTokenEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeMfaCode(code: string) {
  const normalized = code.replace(/[\s-]+/g, "");
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

function mfaIssuer() {
  return process.env.AUTH_MFA_ISSUER?.trim() || "6esk";
}

function base32Encode(buffer: Buffer) {
  let bits = "";
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let encoded = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    encoded += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return encoded;
}

function base32Decode(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid base32 secret.");
    }
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateBase32Secret() {
  return base32Encode(randomBytes(20));
}

export function generateTotpCode(secretBase32: string, now = Date.now()) {
  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function validateTotpCode(secretBase32: string, code: string) {
  const token = normalizeMfaCode(code);
  if (!token) return false;
  const now = Date.now();
  for (let windowOffset = -TOTP_WINDOW; windowOffset <= TOTP_WINDOW; windowOffset += 1) {
    const candidate = generateTotpCode(secretBase32, now + windowOffset * TOTP_PERIOD_SECONDS * 1000);
    if (safeTokenEquals(token, candidate)) {
      return true;
    }
  }
  return false;
}

function totpCredentialId(secretBase32: string) {
  return `totp:${createHash("sha256").update(secretBase32).digest("hex").slice(0, 32)}`;
}

function buildOtpAuthUrl(secretBase32: string, label: string) {
  const issuer = mfaIssuer();
  const account = encodeURIComponent(`${issuer}:${label}`);
  const query = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS)
  });
  return `otpauth://totp/${account}?${query.toString()}`;
}

export function isPrivilegedMfaRole(roleName: string | null | undefined) {
  return (
    roleName === LEAD_ADMIN_ROLE ||
    roleName === TENANT_ADMIN_ROLE ||
    roleName === INTERNAL_ADMIN_ROLE ||
    roleName === INTERNAL_SUPPORT_ROLE
  );
}

export async function isMfaRequiredForLogin(
  user: Pick<ScopedUser, "tenant_id" | "role_name">
) {
  if (!isPrivilegedMfaRole(user.role_name)) {
    return false;
  }

  const policy = await getTenantSecurityPolicy({ tenantId: user.tenant_id }).catch(() => null);
  if (policy) {
    return policy.require_mfa_for_admins;
  }

  return readBoolean(process.env.AUTH_REQUIRE_MFA_ADMIN) === true;
}

export async function listMfaFactorsForUser(user: Pick<ScopedUser, "id" | "tenant_id">) {
  const scope = resolveScope(user);
  const result = await db.query<MfaFactorRecord>(
    `SELECT id,
            factor_type,
            label,
            last_used_at,
            created_at,
            disabled_at
     FROM auth_mfa_factors
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND user_id = $3
     ORDER BY disabled_at IS NULL DESC, created_at DESC
     LIMIT 25`,
    [scope.tenantId, scope.workspaceKey, scope.userId]
  );
  return result.rows;
}

export async function hasActiveMfaFactor(user: Pick<ScopedUser, "id" | "tenant_id">) {
  const scope = resolveScope(user);
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM auth_mfa_factors
       WHERE tenant_id = $1
         AND workspace_key = $2
         AND user_id = $3
         AND factor_type = 'totp'
         AND disabled_at IS NULL
     ) AS exists`,
    [scope.tenantId, scope.workspaceKey, scope.userId]
  );
  return result.rows[0]?.exists === true;
}

export async function getMfaStatusForUser(user: ScopedUser): Promise<MfaStatus> {
  const [required, factors] = await Promise.all([
    isMfaRequiredForLogin(user),
    listMfaFactorsForUser(user)
  ]);
  return { required, factors };
}

export async function createMfaChallenge(user: Pick<ScopedUser, "id" | "tenant_id">) {
  const scope = resolveScope(user);
  const challengeToken = `mfa_${randomBytes(32).toString("base64url")}`;
  const expiresAt = expiresInMinutes(MFA_CHALLENGE_TTL_MINUTES);
  await db.query(
    `INSERT INTO auth_mfa_challenges (
       tenant_id,
       workspace_key,
       user_id,
       challenge_hash,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5)`,
    [scope.tenantId, scope.workspaceKey, scope.userId, tokenHash(challengeToken), expiresAt]
  );
  return { challengeToken, expiresAt } satisfies MfaChallengeStart;
}

export async function startTotpEnrollment({
  user,
  label
}: {
  user: Pick<ScopedUser, "id" | "email" | "tenant_id">;
  label?: string | null;
}) {
  const scope = resolveScope(user);
  const secretBase32 = generateBase32Secret();
  const enrollmentToken = `mfa_enroll_${randomBytes(32).toString("base64url")}`;
  const expiresAt = expiresInMinutes(MFA_ENROLLMENT_TTL_MINUTES);
  const factorLabel = (label?.trim() || user.email || "6esk").slice(0, 120);

  await db.query(
    `INSERT INTO auth_mfa_enrollments (
       tenant_id,
       workspace_key,
       user_id,
       enrollment_hash,
       secret_encrypted,
       label,
       expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      scope.tenantId,
      scope.workspaceKey,
      scope.userId,
      tokenHash(enrollmentToken),
      encryptMfaSecret(secretBase32, scope),
      factorLabel,
      expiresAt
    ]
  );

  return {
    enrollmentToken,
    otpauthUrl: buildOtpAuthUrl(secretBase32, factorLabel),
    secretBase32,
    expiresAt
  } satisfies MfaEnrollmentStart;
}

export async function verifyTotpEnrollment({
  user,
  enrollmentToken,
  code
}: {
  user: Pick<ScopedUser, "id" | "tenant_id">;
  enrollmentToken: string;
  code: string;
}) {
  const scope = resolveScope(user);
  const hash = tokenHash(enrollmentToken);
  const result = await db.query<{
    id: string;
    secret_encrypted: string;
    label: string | null;
  }>(
    `SELECT id, secret_encrypted, label
     FROM auth_mfa_enrollments
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND user_id = $3
       AND enrollment_hash = $4
       AND verified_at IS NULL
       AND expires_at > now()
     LIMIT 1`,
    [scope.tenantId, scope.workspaceKey, scope.userId, hash]
  );
  const enrollment = result.rows[0];
  if (!enrollment) {
    return { ok: false as const, code: "invalid_enrollment" as const };
  }

  const secretBase32 = decryptMfaSecret(enrollment.secret_encrypted, scope);
  if (!validateTotpCode(secretBase32, code)) {
    return { ok: false as const, code: "invalid_code" as const };
  }

  const credentialId = totpCredentialId(secretBase32);
  const factorResult = await db.query<{ id: string }>(
    `INSERT INTO auth_mfa_factors (
       tenant_id,
       workspace_key,
       user_id,
       factor_type,
       label,
       secret_encrypted,
       credential_id
     )
     VALUES ($1, $2, $3, 'totp', $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      scope.tenantId,
      scope.workspaceKey,
      scope.userId,
      enrollment.label ?? "Authenticator app",
      encryptMfaSecret(secretBase32, scope),
      credentialId
    ]
  );

  await db.query(
    `UPDATE auth_mfa_enrollments
     SET verified_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3`,
    [enrollment.id, scope.tenantId, scope.workspaceKey]
  );

  return {
    ok: true as const,
    factorId: factorResult.rows[0]?.id ?? null
  };
}

export async function verifyMfaChallenge({
  challengeToken,
  code
}: {
  challengeToken: string;
  code: string;
}): Promise<MfaChallengeVerification> {
  const hash = tokenHash(challengeToken);
  const result = await db.query<{
    id: string;
    tenant_id: string;
    workspace_key: string;
    user_id: string;
    attempt_count: number;
    expired: boolean;
  }>(
    `SELECT id,
            tenant_id,
            workspace_key,
            user_id,
            attempt_count,
            expires_at <= now() AS expired
     FROM auth_mfa_challenges
     WHERE challenge_hash = $1
       AND used_at IS NULL
     LIMIT 1`,
    [hash]
  );
  const challenge = result.rows[0];
  if (!challenge) {
    return { ok: false, code: "invalid_challenge" };
  }
  const scope = {
    tenantId: challenge.tenant_id,
    workspaceKey: challenge.workspace_key,
    userId: challenge.user_id
  };
  if (challenge.expired) {
    return {
      ok: false,
      code: "expired_challenge",
      tenantId: scope.tenantId,
      workspaceKey: scope.workspaceKey,
      userId: scope.userId
    };
  }
  if (challenge.attempt_count >= MFA_MAX_CHALLENGE_ATTEMPTS) {
    return {
      ok: false,
      code: "too_many_attempts",
      tenantId: scope.tenantId,
      workspaceKey: scope.workspaceKey,
      userId: scope.userId
    };
  }

  const token = normalizeMfaCode(code);
  if (!token) {
    await incrementChallengeAttempts(challenge.id, scope);
    return {
      ok: false,
      code: "invalid_code",
      tenantId: scope.tenantId,
      workspaceKey: scope.workspaceKey,
      userId: scope.userId
    };
  }

  const factorResult = await db.query<{
    id: string;
    secret_encrypted: string;
  }>(
    `SELECT id, secret_encrypted
     FROM auth_mfa_factors
     WHERE tenant_id = $1
       AND workspace_key = $2
       AND user_id = $3
       AND factor_type = 'totp'
       AND disabled_at IS NULL
     ORDER BY created_at DESC
     LIMIT 10`,
    [scope.tenantId, scope.workspaceKey, scope.userId]
  );

  if (factorResult.rows.length === 0) {
    return {
      ok: false,
      code: "mfa_not_configured",
      tenantId: scope.tenantId,
      workspaceKey: scope.workspaceKey,
      userId: scope.userId
    };
  }

  for (const factor of factorResult.rows) {
    const secretBase32 = decryptMfaSecret(factor.secret_encrypted, scope);
    if (!validateTotpCode(secretBase32, token)) continue;

    await db.query(
      `UPDATE auth_mfa_factors
       SET last_used_at = now()
       WHERE id = $1
         AND tenant_id = $2
         AND workspace_key = $3`,
      [factor.id, scope.tenantId, scope.workspaceKey]
    );
    await db.query(
      `UPDATE auth_mfa_challenges
       SET used_at = now()
       WHERE id = $1
         AND tenant_id = $2
         AND workspace_key = $3
         AND used_at IS NULL`,
      [challenge.id, scope.tenantId, scope.workspaceKey]
    );
    return {
      ok: true,
      userId: scope.userId,
      tenantId: scope.tenantId,
      workspaceKey: scope.workspaceKey,
      factorId: factor.id,
      challengeId: challenge.id
    };
  }

  await incrementChallengeAttempts(challenge.id, scope);
  return {
    ok: false,
    code: "invalid_code",
    tenantId: scope.tenantId,
    workspaceKey: scope.workspaceKey,
    userId: scope.userId
  };
}

async function incrementChallengeAttempts(challengeId: string, scope: MfaScope) {
  await db.query(
    `UPDATE auth_mfa_challenges
     SET attempt_count = attempt_count + 1
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3
       AND used_at IS NULL`,
    [challengeId, scope.tenantId, scope.workspaceKey]
  );
}
