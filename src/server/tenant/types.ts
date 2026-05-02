/**
 * Shared types for the multi-tenant system.
 *
 * These types are used across the tenant context, guard, and scoped-db modules
 * and are re-exported by the public `@/server/tenant` barrel.
 */

export type TenantStatus = "active" | "suspended" | "closed";

export type TenantRecord = {
  id: string;
  slug: string;
  displayName: string;
  status: TenantStatus;
  plan: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type TenantContext = {
  /** Tenant UUID — the isolation boundary for all data access. */
  tenantId: string;
  /** Human-readable slug, used in URLs and logs. */
  tenantSlug: string;
  /** Current tenant status. Suspended tenants get read-only access. */
  tenantStatus: TenantStatus;
};

export type WorkspaceRecord = {
  id: string;
  tenantId: string;
  workspaceKey: string;
  displayName: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const DEFAULT_TENANT_SLUG = "default";
