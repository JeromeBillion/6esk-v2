import { db } from "@/server/db";
import { resolveTenantScope, type TenantScope } from "@/server/tenant-context";

export class TenantPublicIngressError extends Error {
  code:
    | "tenant_public_origin_required"
    | "tenant_public_origin_untrusted"
    | "tenant_public_origin_ambiguous";
  status: number;

  constructor(message: string, code: TenantPublicIngressError["code"], status = 403) {
    super(message);
    this.name = "TenantPublicIngressError";
    this.code = code;
    this.status = status;
  }
}

type OriginMapValue =
  | string
  | {
      tenantKey?: string | null;
      workspaceKey?: string | null;
    };

function readBooleanEnv(name: string) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return null;
  return value === "1" || value === "true" || value === "yes";
}

export function shouldRequireTenantPublicIngressOrigin() {
  const configured = readBooleanEnv("TENANT_PUBLIC_INGRESS_REQUIRE_ORIGIN");
  if (configured !== null) {
    return configured;
  }
  return process.env.NODE_ENV === "production";
}

export function normalizePublicIngressOriginKey(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function originKeysFromRequest(request: Pick<Request, "headers" | "url">) {
  const values = [
    request.headers.get("origin"),
    request.headers.get("referer"),
    request.headers.get("host"),
    request.url
  ];
  return Array.from(
    new Set(
      values.map(normalizePublicIngressOriginKey).filter((value): value is string => Boolean(value))
    )
  );
}

function scopeFromMapValue(value: OriginMapValue | undefined): TenantScope | null {
  if (!value) return null;
  if (typeof value === "string") {
    const [tenantKey, workspaceKey] = value.split(":");
    return resolveTenantScope({ tenantKey, workspaceKey });
  }
  return resolveTenantScope({
    tenantKey: value.tenantKey,
    workspaceKey: value.workspaceKey
  });
}

function envPublicIngressOriginMap() {
  const raw = process.env.TENANT_PUBLIC_INGRESS_ORIGINS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [normalizePublicIngressOriginKey(key), value as OriginMapValue])
        .filter(([key]) => key)
    ) as Record<string, OriginMapValue>;
  } catch {
    return {};
  }
}

function scopeFromEnvOrigin(keys: string[]) {
  const originMap = envPublicIngressOriginMap();
  for (const key of keys) {
    const scope = scopeFromMapValue(originMap[key]);
    if (scope) return scope;
  }
  return null;
}

async function scopeFromDbOrigin(keys: string[]) {
  if (!keys.length) return null;
  const result = await db.query<{
    tenant_key: string;
    workspace_key: string;
  }>(
    `SELECT tenant_key, workspace_key
     FROM tenant_public_ingress_origins
     WHERE lower(origin) = ANY($1)
       AND status = 'active'`,
    [keys]
  );
  const scopes = Array.from(
    new Map(
      result.rows.map((row) => [
        `${row.tenant_key}:${row.workspace_key}`,
        resolveTenantScope({
          tenantKey: row.tenant_key,
          workspaceKey: row.workspace_key
        })
      ])
    ).values()
  );
  if (scopes.length > 1) {
    throw new TenantPublicIngressError(
      "Public ingress origin resolves to multiple tenant workspaces.",
      "tenant_public_origin_ambiguous",
      409
    );
  }
  return scopes[0] ?? null;
}

export async function tenantScopeFromPublicIngressRequest(
  request: Pick<Request, "headers" | "url">
): Promise<TenantScope> {
  const keys = originKeysFromRequest(request);
  const envScope = scopeFromEnvOrigin(keys);
  if (envScope) {
    return envScope;
  }

  const dbScope = await scopeFromDbOrigin(keys);
  if (dbScope) {
    return dbScope;
  }

  if (shouldRequireTenantPublicIngressOrigin()) {
    if (!keys.length) {
      throw new TenantPublicIngressError(
        "Public ingress origin is required.",
        "tenant_public_origin_required"
      );
    }
    throw new TenantPublicIngressError(
      "Public ingress origin is not trusted for any tenant workspace.",
      "tenant_public_origin_untrusted"
    );
  }

  return resolveTenantScope();
}

export function isTenantPublicIngressError(error: unknown): error is TenantPublicIngressError {
  return error instanceof TenantPublicIngressError;
}
