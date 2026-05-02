/**
 * Tenant context resolution.
 *
 * Resolves the active tenant from the authenticated user's session.
 * The tenant is NEVER derived from untrusted client input (headers, query params, etc.).
 *
 * Usage:
 *   const ctx = await getTenantContext();
 *   // ctx.tenantId is now safe to use in all downstream queries
 */

import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import type { TenantContext, TenantStatus } from "./types";
import { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from "./types";

/**
 * Resolve the tenant context from the current authenticated session.
 *
 * Returns `null` if the user is not authenticated or the tenant is not found.
 * Call `requireTenantContext()` if you need to fail-closed.
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const user = await getSessionUser();
  if (!user) return null;

  // The user's tenant_id comes from the users table (trusted, server-side).
  // In the v2 auth model, SessionUser includes tenant_id.
  const tenantId = (user as any).tenant_id as string | undefined;

  if (!tenantId) {
    // Fallback for v1 compatibility: assume default tenant
    return {
      tenantId: DEFAULT_TENANT_ID,
      tenantSlug: DEFAULT_TENANT_SLUG,
      tenantStatus: "active",
    };
  }

  const result = await db.query<{
    id: string;
    slug: string;
    status: TenantStatus;
  }>(
    `SELECT id, slug, status FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId]
  );

  const tenant = result.rows[0];
  if (!tenant) return null;

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantStatus: tenant.status,
  };
}

/**
 * Require a valid tenant context or throw.
 *
 * Use this in any API route or service that must have tenant isolation.
 */
export async function requireTenantContext(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx) {
    throw new Error("[Tenant] No tenant context available. Authentication required.");
  }
  if (ctx.tenantStatus === "closed") {
    throw new Error("[Tenant] Tenant account is closed.");
  }
  return ctx;
}

/**
 * Check whether the current tenant is in a read-only state (suspended).
 */
export function isTenantReadOnly(ctx: TenantContext): boolean {
  return ctx.tenantStatus === "suspended";
}
