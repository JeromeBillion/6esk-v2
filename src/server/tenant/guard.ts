/**
 * Tenant boundary guards.
 *
 * These utilities enforce that a request can only access resources
 * belonging to its own tenant. They should be used at service/repository
 * boundaries, not only in route handlers.
 */

import type { TenantContext } from "./types";

/**
 * Assert that two tenant IDs match. Throws if they differ.
 *
 * Use this when loading a resource and verifying it belongs to
 * the current tenant before returning or mutating it.
 */
export function requireTenantMatch(
  sessionTenantId: string,
  resourceTenantId: string,
  resourceType?: string
): void {
  if (sessionTenantId !== resourceTenantId) {
    const label = resourceType ? ` on ${resourceType}` : "";
    throw new Error(
      `[Tenant] Cross-tenant access denied${label}. ` +
      `Session tenant: ${sessionTenantId}, resource tenant: ${resourceTenantId}`
    );
  }
}

/**
 * Assert that the tenant is not in a read-only state.
 *
 * Use this before any mutation (create, update, delete) to enforce
 * that suspended tenants cannot write.
 */
export function requireTenantWritable(ctx: TenantContext): void {
  if (ctx.tenantStatus === "suspended") {
    throw new Error(
      `[Tenant] Tenant ${ctx.tenantSlug} is suspended. Write operations are not allowed.`
    );
  }
  if (ctx.tenantStatus === "closed") {
    throw new Error(
      `[Tenant] Tenant ${ctx.tenantSlug} is closed. All operations are disabled.`
    );
  }
}

/**
 * Verify a loaded resource belongs to the current tenant context.
 *
 * Returns the resource if it passes, throws if cross-tenant.
 */
export function guardResource<T extends { tenant_id?: string; tenantId?: string }>(
  ctx: TenantContext,
  resource: T | null | undefined,
  resourceType: string
): T {
  if (!resource) {
    throw new Error(`[Tenant] ${resourceType} not found.`);
  }
  const resourceTenantId = resource.tenant_id ?? resource.tenantId;
  if (!resourceTenantId) {
    throw new Error(
      `[Tenant] ${resourceType} has no tenant_id. Cannot verify ownership.`
    );
  }
  requireTenantMatch(ctx.tenantId, resourceTenantId, resourceType);
  return resource;
}
