export type AuthCacheProvider = "none" | "upstash" | "valkey" | "redis";

export type AuthCacheConfig =
  | {
      provider: "none";
      required: boolean;
    }
  | {
      provider: "upstash";
      required: boolean;
      restUrl: string | null;
      restToken: string | null;
    }
  | {
      provider: "valkey" | "redis";
      required: boolean;
      url: string | null;
    };

function readProvider(value: string | undefined): AuthCacheProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "upstash" || normalized === "valkey" || normalized === "redis") {
    return normalized;
  }
  return "none";
}

function readBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function oauthEnabled(env: NodeJS.ProcessEnv) {
  return (
    readBoolean(env.AUTH_OAUTH_ENABLED) ||
    env.AUTH_PROVIDER?.trim().toLowerCase() === "better_auth" ||
    Boolean(env.AUTH_GOOGLE_CLIENT_ID || env.AUTH_MICROSOFT_CLIENT_ID || env.AUTH_OIDC_ISSUER)
  );
}

export function resolveAuthCacheConfig(env: NodeJS.ProcessEnv = process.env): AuthCacheConfig {
  const provider = readProvider(env.AUTH_CACHE_PROVIDER);
  const required = env.NODE_ENV === "production" && oauthEnabled(env);

  if (provider === "upstash") {
    return {
      provider,
      required,
      restUrl: env.UPSTASH_REDIS_REST_URL?.trim() || null,
      restToken: env.UPSTASH_REDIS_REST_TOKEN?.trim() || null
    };
  }

  if (provider === "valkey" || provider === "redis") {
    return {
      provider,
      required,
      url: env.AUTH_REDIS_URL?.trim() || null
    };
  }

  return { provider: "none", required };
}
