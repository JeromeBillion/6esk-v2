import { createHmac, timingSafeEqual } from "crypto";
import {
  listActiveTenantIngressSigningSecrets,
  markTenantIngressSigningSecretUsed,
  type ActiveTenantIngressSigningSecret
} from "@/server/tenant-ingress-secrets";

export const DEFAULT_TENANT_KEY = "primary";
export const DEFAULT_WORKSPACE_KEY = "primary";

export type TenantScope = {
  tenantKey: string;
  workspaceKey: string;
};

export type TenantScopedUser = {
  tenant_key?: string | null;
  workspace_key?: string | null;
};

export type TenantScopeInput = {
  tenantKey?: string | null;
  workspaceKey?: string | null;
} | null | undefined;

export class TenantIngressScopeError extends Error {
  code:
    | "tenant_scope_required"
    | "tenant_scope_incomplete"
    | "tenant_signature_required"
    | "tenant_signature_invalid"
    | "tenant_signature_timestamp_invalid"
    | "tenant_signature_timestamp_expired"
    | "tenant_signature_secret_missing";
  status: number;

  constructor(message: string, code: TenantIngressScopeError["code"], status = 400) {
    super(message);
    this.name = "TenantIngressScopeError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeTenantKey(value?: string | null) {
  return value?.trim() || DEFAULT_TENANT_KEY;
}

export function normalizeWorkspaceKey(value?: string | null) {
  return value?.trim() || DEFAULT_WORKSPACE_KEY;
}

export function resolveTenantScope(input?: TenantScopeInput): TenantScope {
  return {
    tenantKey: normalizeTenantKey(input?.tenantKey),
    workspaceKey: normalizeWorkspaceKey(input?.workspaceKey)
  };
}

export function tenantScopeFromUser(user?: TenantScopedUser | null): TenantScope {
  return resolveTenantScope({
    tenantKey: user?.tenant_key,
    workspaceKey: user?.workspace_key
  });
}

function readBooleanEnv(name: string) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return null;
  return value === "1" || value === "true" || value === "yes";
}

export function shouldRequireTenantIngressScope() {
  const configured = readBooleanEnv("TENANT_INGRESS_REQUIRE_SCOPE");
  if (configured !== null) {
    return configured;
  }
  return process.env.NODE_ENV === "production";
}

export function shouldRequireTenantIngressSignature() {
  const configured = readBooleanEnv("TENANT_INGRESS_REQUIRE_SIGNATURE");
  if (configured !== null) {
    return configured;
  }
  return process.env.NODE_ENV === "production";
}

function normalizeSignature(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().startsWith("sha256=") ? trimmed : `sha256=${trimmed}`;
}

function parseTimestamp(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return null;
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function tenantIngressSignatureMaxSkewSeconds() {
  const configured = Number(process.env.TENANT_INGRESS_SIGNATURE_MAX_SKEW_SECONDS ?? "300");
  if (!Number.isFinite(configured) || configured < 0) {
    return 300;
  }
  return Math.floor(configured);
}

function requestPathForSignature(request: Pick<Request, "url"> | Partial<Pick<Request, "url">>) {
  if (!request.url) return "/";
  try {
    const url = new URL(request.url);
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

function signingSecretMap() {
  const raw = process.env.TENANT_INGRESS_SIGNING_SECRETS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const entries = Object.entries(parsed)
      .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""])
      .filter(([key, value]) => key && value);
    return Object.fromEntries(entries) as Record<string, string>;
  } catch {
    return {};
  }
}

function tenantIngressSigningSecretsFromEnv(scope: TenantScope): ActiveTenantIngressSigningSecret[] {
  const secrets = signingSecretMap();
  const exactKey = `${scope.tenantKey}:${scope.workspaceKey}`;
  const tenantWildcardKey = `${scope.tenantKey}:*`;
  const secret =
    secrets[exactKey] ??
    secrets[tenantWildcardKey] ??
    secrets[scope.tenantKey] ??
    secrets["*"] ??
    null;
  if (secret) {
    return [{ id: "env", secret }];
  }

  const globalSecret = process.env.TENANT_INGRESS_SIGNING_SECRET?.trim();
  const allowGlobal = readBooleanEnv("TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET") === true;
  if (globalSecret && (allowGlobal || process.env.NODE_ENV !== "production")) {
    return [{ id: "env", secret: globalSecret }];
  }
  return [];
}

export function buildTenantIngressSignature({
  tenantKey,
  workspaceKey,
  method,
  path,
  timestamp,
  secret
}: {
  tenantKey: string;
  workspaceKey: string;
  method: string;
  path: string;
  timestamp: string;
  secret: string;
}) {
  const payload = [
    "tenant-ingress.v1",
    tenantKey,
    workspaceKey,
    method.trim().toUpperCase() || "GET",
    path || "/",
    timestamp
  ].join("\n");
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

function verifyTenantIngressSignature(
  request: Pick<Request, "headers"> & Partial<Pick<Request, "method" | "url">>,
  scope: TenantScope
) {
  if (!shouldRequireTenantIngressSignature()) {
    return;
  }

  const timestamp = request.headers.get("x-6esk-tenant-timestamp")?.trim() ?? "";
  const providedSignature = normalizeSignature(request.headers.get("x-6esk-tenant-signature"));
  if (!timestamp || !providedSignature) {
    throw new TenantIngressScopeError(
      "Signed tenant envelope is required for machine ingress.",
      "tenant_signature_required",
      401
    );
  }

  const parsedTimestamp = parseTimestamp(timestamp);
  if (!parsedTimestamp) {
    throw new TenantIngressScopeError(
      "Tenant ingress signature timestamp is invalid.",
      "tenant_signature_timestamp_invalid",
      401
    );
  }

  const maxSkewSeconds = tenantIngressSignatureMaxSkewSeconds();
  if (maxSkewSeconds > 0) {
    const deltaMs = Math.abs(Date.now() - parsedTimestamp.getTime());
    if (deltaMs > maxSkewSeconds * 1000) {
      throw new TenantIngressScopeError(
        "Tenant ingress signature timestamp is outside the replay window.",
        "tenant_signature_timestamp_expired",
        401
      );
    }
  }

  const secrets = tenantIngressSigningSecretsFromEnv(scope);
  const matchedSecret = matchTenantIngressSignature(request, scope, timestamp, providedSignature, secrets);
  if (!secrets.length) {
    throw new TenantIngressScopeError(
      "Tenant ingress signing secret is not configured.",
      "tenant_signature_secret_missing",
      503
    );
  }
  if (!matchedSecret) {
    throw new TenantIngressScopeError(
      "Tenant ingress signature is invalid.",
      "tenant_signature_invalid",
      401
    );
  }
}

function matchTenantIngressSignature(
  request: Pick<Request, "headers"> & Partial<Pick<Request, "method" | "url">>,
  scope: TenantScope,
  timestamp: string,
  providedSignature: string,
  secrets: ActiveTenantIngressSigningSecret[]
) {
  for (const secretRecord of secrets) {
    const expectedSignature = buildTenantIngressSignature({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      method: request.method ?? "GET",
      path: requestPathForSignature(request),
      timestamp,
      secret: secretRecord.secret
    });
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const providedBuffer = Buffer.from(providedSignature, "utf8");
    const matches =
      expectedBuffer.length === providedBuffer.length &&
      timingSafeEqual(expectedBuffer, providedBuffer);
    if (matches) {
      return secretRecord;
    }
  }
  return null;
}

async function verifyTenantIngressSignatureAsync(
  request: Pick<Request, "headers"> & Partial<Pick<Request, "method" | "url">>,
  scope: TenantScope
) {
  if (!shouldRequireTenantIngressSignature()) {
    return;
  }

  const timestamp = request.headers.get("x-6esk-tenant-timestamp")?.trim() ?? "";
  const providedSignature = normalizeSignature(request.headers.get("x-6esk-tenant-signature"));
  if (!timestamp || !providedSignature) {
    throw new TenantIngressScopeError(
      "Signed tenant envelope is required for machine ingress.",
      "tenant_signature_required",
      401
    );
  }

  const parsedTimestamp = parseTimestamp(timestamp);
  if (!parsedTimestamp) {
    throw new TenantIngressScopeError(
      "Tenant ingress signature timestamp is invalid.",
      "tenant_signature_timestamp_invalid",
      401
    );
  }

  const maxSkewSeconds = tenantIngressSignatureMaxSkewSeconds();
  if (maxSkewSeconds > 0) {
    const deltaMs = Math.abs(Date.now() - parsedTimestamp.getTime());
    if (deltaMs > maxSkewSeconds * 1000) {
      throw new TenantIngressScopeError(
        "Tenant ingress signature timestamp is outside the replay window.",
        "tenant_signature_timestamp_expired",
        401
      );
    }
  }

  const envSecrets = tenantIngressSigningSecretsFromEnv(scope);
  const envMatchedSecret = matchTenantIngressSignature(
    request,
    scope,
    timestamp,
    providedSignature,
    envSecrets
  );
  if (envMatchedSecret) {
    return;
  }

  let persistedSecrets: ActiveTenantIngressSigningSecret[] = [];
  try {
    persistedSecrets = await listActiveTenantIngressSigningSecrets(scope);
  } catch (error) {
    if (!envSecrets.length) {
      throw new TenantIngressScopeError(
        "Tenant ingress signing secret is not configured.",
        "tenant_signature_secret_missing",
        503
      );
    }
  }
  if (!envSecrets.length && !persistedSecrets.length) {
    throw new TenantIngressScopeError(
      "Tenant ingress signing secret is not configured.",
      "tenant_signature_secret_missing",
      503
    );
  }

  const matchedSecret = matchTenantIngressSignature(
    request,
    scope,
    timestamp,
    providedSignature,
    persistedSecrets
  );
  if (!matchedSecret) {
    throw new TenantIngressScopeError(
      "Tenant ingress signature is invalid.",
      "tenant_signature_invalid",
      401
    );
  }
  await markTenantIngressSigningSecretUsed(matchedSecret.id, scope).catch(() => {});
}

export function tenantScopeFromMachineRequest(
  request: Pick<Request, "headers"> & Partial<Pick<Request, "method" | "url">>
): TenantScope {
  const tenantKey = request.headers.get("x-6esk-tenant")?.trim() ?? "";
  const workspaceKey = request.headers.get("x-6esk-workspace")?.trim() ?? "";

  if (tenantKey && workspaceKey) {
    const scope = resolveTenantScope({ tenantKey, workspaceKey });
    verifyTenantIngressSignature(request, scope);
    return scope;
  }

  if (tenantKey || workspaceKey) {
    throw new TenantIngressScopeError(
      "Both x-6esk-tenant and x-6esk-workspace are required for machine ingress.",
      "tenant_scope_incomplete"
    );
  }

  if (shouldRequireTenantIngressScope() || shouldRequireTenantIngressSignature()) {
    throw new TenantIngressScopeError(
      "Tenant scope is required for machine ingress.",
      "tenant_scope_required"
    );
  }

  return resolveTenantScope();
}

export async function tenantScopeFromMachineRequestAsync(
  request: Pick<Request, "headers"> & Partial<Pick<Request, "method" | "url">>
): Promise<TenantScope> {
  const tenantKey = request.headers.get("x-6esk-tenant")?.trim() ?? "";
  const workspaceKey = request.headers.get("x-6esk-workspace")?.trim() ?? "";

  if (tenantKey && workspaceKey) {
    const scope = resolveTenantScope({ tenantKey, workspaceKey });
    await verifyTenantIngressSignatureAsync(request, scope);
    return scope;
  }

  if (tenantKey || workspaceKey) {
    throw new TenantIngressScopeError(
      "Both x-6esk-tenant and x-6esk-workspace are required for machine ingress.",
      "tenant_scope_incomplete"
    );
  }

  if (shouldRequireTenantIngressScope() || shouldRequireTenantIngressSignature()) {
    throw new TenantIngressScopeError(
      "Tenant scope is required for machine ingress.",
      "tenant_scope_required"
    );
  }

  return resolveTenantScope();
}

export function isTenantIngressScopeError(error: unknown): error is TenantIngressScopeError {
  return error instanceof TenantIngressScopeError;
}
