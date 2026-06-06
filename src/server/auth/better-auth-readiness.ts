import { resolveAuthCacheConfig } from "@/server/auth/cache";

export type BetterAuthProviderReadiness = {
  id: "google" | "microsoft" | "oidc";
  configured: boolean;
  missing: string[];
};

export type BetterAuthReadiness = {
  packageInstalled: true;
  authProvider: string;
  enabled: boolean;
  routePath: string;
  routeEnabled: boolean;
  dbBridgeReady: boolean;
  ready: boolean;
  blockers: string[];
  providers: BetterAuthProviderReadiness[];
  cache: {
    provider: string;
    required: boolean;
    configured: boolean;
  };
  policy: {
    requireMfaForAdmins: boolean;
    sessionDeviceTracking: boolean;
    allowedEmailDomains: string[];
  };
};

function readBoolean(value: string | undefined | null) {
  const normalized = value?.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized ?? "");
}

function readString(value: string | undefined | null) {
  const normalized = value?.trim();
  return normalized && !/^replace-with/i.test(normalized) ? normalized : "";
}

function readList(value: string | undefined | null) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function providerReadiness(id: BetterAuthProviderReadiness["id"], required: Record<string, string>) {
  const missing = Object.entries(required)
    .filter(([, value]) => !readString(value))
    .map(([name]) => name);
  return {
    id,
    configured: missing.length === 0,
    missing
  };
}

function cacheConfigured(cache: ReturnType<typeof resolveAuthCacheConfig>) {
  if (cache.provider === "none") return !cache.required;
  if (cache.provider === "upstash") return Boolean(cache.restUrl && cache.restToken);
  return Boolean(cache.url);
}

export function getBetterAuthReadiness(env: NodeJS.ProcessEnv = process.env): BetterAuthReadiness {
  const authProvider = (env.AUTH_PROVIDER ?? "password").trim().toLowerCase();
  const oauthEnabled = readBoolean(env.AUTH_OAUTH_ENABLED) || authProvider === "better_auth";
  const routeEnabled = readBoolean(env.AUTH_BETTER_AUTH_ROUTE_ENABLED);
  const dbBridgeReady = readBoolean(env.AUTH_BETTER_AUTH_DB_BRIDGE_READY);
  const routePath = "/api/auth/better";
  const cache = resolveAuthCacheConfig(env);

  const providers: BetterAuthProviderReadiness[] = [
    providerReadiness("google", {
      AUTH_GOOGLE_CLIENT_ID: env.AUTH_GOOGLE_CLIENT_ID ?? "",
      AUTH_GOOGLE_CLIENT_SECRET: env.AUTH_GOOGLE_CLIENT_SECRET ?? ""
    }),
    providerReadiness("microsoft", {
      AUTH_MICROSOFT_CLIENT_ID: env.AUTH_MICROSOFT_CLIENT_ID ?? "",
      AUTH_MICROSOFT_CLIENT_SECRET: env.AUTH_MICROSOFT_CLIENT_SECRET ?? "",
      AUTH_MICROSOFT_TENANT_ID: env.AUTH_MICROSOFT_TENANT_ID ?? ""
    }),
    providerReadiness("oidc", {
      AUTH_OIDC_ISSUER: env.AUTH_OIDC_ISSUER ?? "",
      AUTH_OIDC_CLIENT_ID: env.AUTH_OIDC_CLIENT_ID ?? "",
      AUTH_OIDC_CLIENT_SECRET: env.AUTH_OIDC_CLIENT_SECRET ?? ""
    })
  ];

  const blockers: string[] = [];
  const enabled = oauthEnabled || routeEnabled;
  const hasProvider = providers.some((provider) => provider.configured);
  const requireMfaForAdmins = readBoolean(env.AUTH_REQUIRE_MFA_ADMIN);
  const sessionDeviceTracking = readBoolean(env.AUTH_SESSION_DEVICE_TRACKING);
  const configuredCache = cacheConfigured(cache);

  if (enabled && authProvider !== "better_auth") {
    blockers.push("AUTH_PROVIDER must be better_auth before OAuth routes can be used.");
  }
  if (enabled && !readString(env.BETTER_AUTH_SECRET)) {
    blockers.push("BETTER_AUTH_SECRET is missing.");
  }
  if (enabled && !hasProvider) {
    blockers.push("At least one Google, Microsoft, or OIDC provider must be fully configured.");
  }
  if (routeEnabled && !dbBridgeReady) {
    blockers.push("Tenant-safe Better Auth database bridge is not marked ready.");
  }
  if (env.NODE_ENV === "production" && enabled && !requireMfaForAdmins) {
    blockers.push("Admin MFA must be required in production.");
  }
  if (env.NODE_ENV === "production" && enabled && !sessionDeviceTracking) {
    blockers.push("Session/device tracking must be enabled in production.");
  }
  if (cache.required && !configuredCache) {
    blockers.push("Required auth cache is not configured.");
  }

  return {
    packageInstalled: true,
    authProvider,
    enabled,
    routePath,
    routeEnabled,
    dbBridgeReady,
    ready: enabled && routeEnabled && dbBridgeReady && blockers.length === 0,
    blockers,
    providers,
    cache: {
      provider: cache.provider,
      required: cache.required,
      configured: configuredCache
    },
    policy: {
      requireMfaForAdmins,
      sessionDeviceTracking,
      allowedEmailDomains: readList(env.AUTH_ALLOWED_EMAIL_DOMAINS)
    }
  };
}
