/**
 * Tenant module — public barrel export.
 *
 * Import from `@/server/tenant` for all multi-tenant utilities.
 */

// Types
export type { TenantContext, TenantRecord, TenantStatus, WorkspaceRecord } from "./types";
export { DEFAULT_TENANT_ID, DEFAULT_TENANT_SLUG } from "./types";

// Context resolution
export { getTenantContext, requireTenantContext, isTenantReadOnly } from "./context";

// Guards
export { requireTenantMatch, requireTenantWritable, guardResource } from "./guard";

// Scoped database
export { createScopedDb, type ScopedDb } from "./scoped-db";
