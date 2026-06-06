import { betterAuth, type BetterAuthOptions } from "better-auth";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import type { SocialProviders } from "@better-auth/core/social-providers";
import type { PostgresPool } from "kysely";
import { db } from "@/server/db";
import { getBetterAuthReadiness, type BetterAuthProviderReadiness } from "@/server/auth/better-auth-readiness";
import { resolveBetterAuthBridgeUser } from "@/server/auth/better-auth-bridge";

export type PublicAuthProvider = {
  id: BetterAuthProviderReadiness["id"];
  label: string;
  flow: "social" | "generic_oauth";
};

function readString(value: string | undefined | null) {
  return value?.trim() ?? "";
}

function readBoolean(value: string | undefined | null) {
  const normalized = value?.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized ?? "");
}

function readTtlSeconds() {
  const days = Number(process.env.SESSION_TTL_DAYS ?? 14);
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 90) : 14;
  return Math.trunc(safeDays * 24 * 60 * 60);
}

function originFromUrl(value: string | undefined | null) {
  const raw = readString(value);
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function trustedOrigins() {
  return Array.from(
    new Set(
      [originFromUrl(process.env.APP_URL), originFromUrl(process.env.BETTER_AUTH_URL)]
        .filter((origin): origin is string => Boolean(origin))
    )
  );
}

function oidcDiscoveryUrl(issuer: string) {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

export function getPublicAuthProviders(env: NodeJS.ProcessEnv = process.env): PublicAuthProvider[] {
  const readiness = getBetterAuthReadiness(env);
  if (!readiness.ready) return [];

  const providers: PublicAuthProvider[] = [];
  for (const provider of readiness.providers) {
    if (!provider.configured) continue;
    if (provider.id === "google") {
      providers.push({ id: "google", label: "Google", flow: "social" });
    }
    if (provider.id === "microsoft") {
      providers.push({ id: "microsoft", label: "Microsoft", flow: "social" });
    }
    if (provider.id === "oidc") {
      providers.push({ id: "oidc", label: "Company SSO", flow: "generic_oauth" });
    }
  }
  return providers;
}

function socialProviders(): SocialProviders {
  const providers: SocialProviders = {};
  const googleClientId = readString(process.env.AUTH_GOOGLE_CLIENT_ID);
  const googleClientSecret = readString(process.env.AUTH_GOOGLE_CLIENT_SECRET);
  if (googleClientId && googleClientSecret) {
    providers.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      accessType: "online",
      scope: ["openid", "email", "profile"],
      disableIdTokenSignIn: true
    };
  }

  const microsoftClientId = readString(process.env.AUTH_MICROSOFT_CLIENT_ID);
  const microsoftClientSecret = readString(process.env.AUTH_MICROSOFT_CLIENT_SECRET);
  const microsoftTenantId = readString(process.env.AUTH_MICROSOFT_TENANT_ID) || "organizations";
  if (microsoftClientId && microsoftClientSecret && microsoftTenantId) {
    providers.microsoft = {
      clientId: microsoftClientId,
      clientSecret: microsoftClientSecret,
      tenantId: microsoftTenantId,
      scope: ["openid", "email", "profile"],
      disableIdTokenSignIn: true
    };
  }

  return providers;
}

function genericOAuthPlugins() {
  const issuer = readString(process.env.AUTH_OIDC_ISSUER);
  const clientId = readString(process.env.AUTH_OIDC_CLIENT_ID);
  const clientSecret = readString(process.env.AUTH_OIDC_CLIENT_SECRET);
  if (!issuer || !clientId || !clientSecret) {
    return [];
  }

  return [
    genericOAuth({
      config: [
        {
          providerId: "oidc",
          discoveryUrl: oidcDiscoveryUrl(issuer),
          issuer,
          requireIssuerValidation: true,
          clientId,
          clientSecret,
          scopes: ["openid", "email", "profile"],
          pkce: true,
          authentication: "post"
        }
      ]
    })
  ];
}

function buildBetterAuthOptions(): BetterAuthOptions {
  const baseURL = readString(process.env.BETTER_AUTH_URL) || readString(process.env.APP_URL) || "http://localhost:3000";
  const production = process.env.NODE_ENV === "production";

  return {
    appName: "6esk",
    baseURL,
    basePath: "/api/auth/better",
    secret:
      readString(process.env.BETTER_AUTH_SECRET) ||
      readString(process.env.SESSION_SECRET) ||
      "development-better-auth-secret-do-not-use-in-production",
    database: db as unknown as PostgresPool,
    trustedOrigins: trustedOrigins(),
    socialProviders: socialProviders(),
    emailAndPassword: {
      enabled: false
    },
    user: {
      modelName: "better_auth_users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at"
      }
    },
    session: {
      modelName: "better_auth_sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at"
      },
      expiresIn: readTtlSeconds(),
      updateAge: 24 * 60 * 60,
      preserveSessionInDatabase: true,
      cookieCache: {
        enabled: false
      }
    },
    account: {
      modelName: "better_auth_accounts",
      fields: {
        providerId: "provider_id",
        accountId: "account_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at"
      },
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        trustedProviders: []
      }
    },
    verification: {
      modelName: "better_auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at"
      },
      storeIdentifier: "hashed",
      storeInDatabase: true
    },
    rateLimit: {
      enabled: false
    },
    advanced: {
      useSecureCookies: production,
      disableCSRFCheck: false,
      disableOriginCheck: false
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const email = typeof user.email === "string" ? user.email : "";
            if (!email) return false;
            const bridgeResolution = await resolveBetterAuthBridgeUser(email);
            return bridgeResolution.ok;
          }
        }
      }
    },
    plugins: [...genericOAuthPlugins(), nextCookies()],
    telemetry: {
      enabled: false
    }
  };
}

export function isBetterAuthRouteEnabled() {
  return getBetterAuthReadiness().ready;
}

export const sixeskBetterAuth = betterAuth(buildBetterAuthOptions());
export const betterAuthNextHandlers = toNextJsHandler(sixeskBetterAuth);
