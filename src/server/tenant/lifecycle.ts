/**
 * Tenant lifecycle operations.
 *
 * Covers provisioning, suspension, closure, and status management
 * for the multi-tenant SaaS platform.
 */

import { db } from "@/server/db";
import { recordAuditLogWithClient } from "@/server/audit";
import type { TenantRecord, TenantStatus } from "./types";

// -------------------------------------------------------------------------
// Tenant CRUD
// -------------------------------------------------------------------------

/**
 * Provision a new tenant with a workspace and default entitlements.
 */
export async function provisionTenant({
  slug,
  displayName,
  plan = "starter",
  settings = {},
  actorUserId
}: {
  slug: string;
  displayName: string;
  plan?: string;
  settings?: Record<string, unknown>;
  actorUserId?: string | null;
}): Promise<TenantRecord> {
  // Validate slug format
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
    throw new Error(
      "[Tenant] Invalid slug. Must be 3-64 lowercase alphanumeric chars or hyphens, " +
      "starting and ending with alphanumeric."
    );
  }

  const client = await db.connect();
  let committed = false;
  let provisionedTenant: TenantRecord | null = null;
  try {
    await client.query("BEGIN");

    // 1. Create tenant
    const tenantResult = await client.query<{
      id: string;
      slug: string;
      display_name: string;
      status: TenantStatus;
      plan: string;
      settings: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO tenants (slug, display_name, plan, settings)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, slug, display_name, status::text, plan, settings,
                 created_at::text, updated_at::text`,
      [slug, displayName, plan, JSON.stringify(settings)]
    );
    const tenant = tenantResult.rows[0];

    // 2. Create default workspace
    await client.query(
      `INSERT INTO workspaces (tenant_id, workspace_key, display_name)
       VALUES ($1, 'primary', $2)`,
      [tenant.id, `${displayName} Workspace`]
    );

    // 3. Create default workspace_modules entry
    await client.query(
      `INSERT INTO workspace_modules (tenant_id, workspace_key, modules, updated_at)
       VALUES ($1, 'primary', $2::jsonb, now())`,
      [
        tenant.id,
        JSON.stringify({
          email: true,
          whatsapp: false,
          voice: false,
          aiAutomation: false,
          dexterOrchestration: false,
          vanillaWebchat: true
        })
      ]
    );

    // 4. Seed entitlements based on plan
    const moduleKeys = planModuleDefaults(plan);
    for (const moduleKey of moduleKeys) {
      await client.query(
        `INSERT INTO tenant_entitlements (tenant_id, module_key, is_enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (tenant_id, module_key) DO NOTHING`,
        [tenant.id, moduleKey]
      );
    }

    provisionedTenant = mapTenant(tenant);
    await recordAuditLogWithClient(client, {
      tenantId: provisionedTenant.id,
      actorUserId: actorUserId ?? null,
      action: "tenant_provisioned",
      entityType: "tenant",
      entityId: provisionedTenant.id,
      data: { slug, plan, displayName }
    });

    await client.query("COMMIT");
    committed = true;
  } catch (err) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    throw err;
  } finally {
    client.release();
  }

  if (!provisionedTenant) {
    throw new TenantLifecycleError("Tenant provision did not return a row", "TENANT_NOT_FOUND", 404);
  }

  return provisionedTenant;
}

export class TenantLifecycleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "TENANT_NOT_FOUND"
      | "TENANT_SUSPENDED"
      | "TENANT_CLOSED"
      | "INVALID_TENANT_TRANSITION",
    public readonly status = 400
  ) {
    super(message);
    this.name = "TenantLifecycleError";
  }
}

type TenantRow = {
  id: string;
  slug: string;
  display_name: string;
  status: TenantStatus;
  plan: string;
  settings: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type LifecycleEvent = {
  action: string;
  status: TenantStatus;
  reason: string | null;
  actorUserId: string | null;
  at: string;
  previousStatus?: TenantStatus;
  previousPlan?: string;
  nextPlan?: string;
};

function mapTenant(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    plan: row.plan,
    settings: row.settings ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function appendLifecycleEvent(
  settings: Record<string, unknown> | null | undefined,
  event: LifecycleEvent
) {
  const safeSettings = isRecord(settings) ? settings : {};
  const currentLifecycle = isRecord(safeSettings.lifecycle) ? safeSettings.lifecycle : {};
  const currentHistory = Array.isArray(currentLifecycle.history)
    ? currentLifecycle.history.slice(-24)
    : [];

  return {
    ...safeSettings,
    lifecycle: {
      ...currentLifecycle,
      status: event.status,
      lastAction: event.action,
      lastReason: event.reason,
      lastActorUserId: event.actorUserId,
      updatedAt: event.at,
      suspendedAt:
        event.status === "suspended" ? event.at : currentLifecycle.suspendedAt ?? null,
      reactivatedAt:
        event.action === "tenant_reactivated" ? event.at : currentLifecycle.reactivatedAt ?? null,
      closedAt: event.status === "closed" ? event.at : currentLifecycle.closedAt ?? null,
      history: [...currentHistory, event]
    }
  };
}

function requireTenantTransition(current: TenantStatus, next: TenantStatus) {
  if (current === "closed" && next !== "closed") {
    throw new TenantLifecycleError(
      "Closed tenants are terminal and cannot be reactivated or suspended.",
      "TENANT_CLOSED",
      409
    );
  }
}

async function updateTenantStatus({
  tenantId,
  nextStatus,
  reason,
  actorUserId,
  auditAction
}: {
  tenantId: string;
  nextStatus: TenantStatus;
  reason: string | null;
  actorUserId?: string | null;
  auditAction: string;
}): Promise<TenantRecord> {
  const client = await db.connect();
  let committed = false;
  let updatedTenant: TenantRecord | null = null;
  let auditData: Record<string, unknown> | null = null;
  try {
    await client.query("BEGIN");

    const currentResult = await client.query<TenantRow>(
      `SELECT id, slug, display_name, status::text, plan, settings,
              created_at::text, updated_at::text
       FROM tenants
       WHERE id = $1
       FOR UPDATE`,
      [tenantId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      throw new TenantLifecycleError("Tenant not found", "TENANT_NOT_FOUND", 404);
    }

    requireTenantTransition(current.status, nextStatus);

    const event: LifecycleEvent = {
      action: auditAction,
      status: nextStatus,
      reason,
      actorUserId: actorUserId ?? null,
      at: new Date().toISOString(),
      previousStatus: current.status
    };
    const settings = appendLifecycleEvent(current.settings, event);

    const updateResult = await client.query<TenantRow>(
      `UPDATE tenants
       SET status = $2::tenant_status, settings = $3::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING id, slug, display_name, status::text, plan, settings,
                 created_at::text, updated_at::text`,
      [tenantId, nextStatus, JSON.stringify(settings)]
    );

    updatedTenant = mapTenant(updateResult.rows[0]);
    auditData = {
      reason,
      previousStatus: current.status,
      status: nextStatus
    };
    await recordAuditLogWithClient(client, {
      tenantId,
      actorUserId: actorUserId ?? null,
      action: auditAction,
      entityType: "tenant",
      entityId: tenantId,
      data: auditData
    });

    await client.query("COMMIT");
    committed = true;
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }

  if (!updatedTenant) {
    throw new TenantLifecycleError("Tenant update did not return a row", "TENANT_NOT_FOUND", 404);
  }
  return updatedTenant;
}

/**
 * Suspend a tenant. Read-only access remains, writes and new billable usage are blocked.
 */
export async function suspendTenant(
  tenantId: string,
  reason: string,
  actorUserId?: string | null
) {
  return updateTenantStatus({
    tenantId,
    nextStatus: "suspended",
    reason,
    actorUserId,
    auditAction: "tenant_suspended"
  });
}

/**
 * Reactivate a suspended tenant.
 */
export async function reactivateTenant(tenantId: string, actorUserId?: string | null) {
  return updateTenantStatus({
    tenantId,
    nextStatus: "active",
    reason: null,
    actorUserId,
    auditAction: "tenant_reactivated"
  });
}

/**
 * Close a tenant. All runtime access is disabled. Closed is intentionally terminal.
 */
export async function closeTenant(tenantId: string, reason: string, actorUserId?: string | null) {
  return updateTenantStatus({
    tenantId,
    nextStatus: "closed",
    reason,
    actorUserId,
    auditAction: "tenant_closed"
  });
}

/**
 * Change a tenant plan without mutating module entitlements.
 *
 * Entitlements remain the operational source of truth for feature access; plan changes
 * update the commercial boundary and are reconciled by billing/ops workflows.
 */
export async function changeTenantPlan({
  tenantId,
  plan,
  reason,
  actorUserId
}: {
  tenantId: string;
  plan: string;
  reason?: string | null;
  actorUserId?: string | null;
}): Promise<TenantRecord> {
  const normalizedPlan = plan.trim();
  if (!normalizedPlan) {
    throw new TenantLifecycleError("Tenant plan is required", "INVALID_TENANT_TRANSITION", 400);
  }

  const client = await db.connect();
  let committed = false;
  let updatedTenant: TenantRecord | null = null;
  let auditData: Record<string, unknown> | null = null;
  try {
    await client.query("BEGIN");

    const currentResult = await client.query<TenantRow>(
      `SELECT id, slug, display_name, status::text, plan, settings,
              created_at::text, updated_at::text
       FROM tenants
       WHERE id = $1
       FOR UPDATE`,
      [tenantId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      throw new TenantLifecycleError("Tenant not found", "TENANT_NOT_FOUND", 404);
    }
    if (current.status === "closed") {
      throw new TenantLifecycleError(
        "Closed tenants cannot change plan.",
        "TENANT_CLOSED",
        409
      );
    }

    const event: LifecycleEvent = {
      action: "tenant_plan_changed",
      status: current.status,
      reason: reason ?? null,
      actorUserId: actorUserId ?? null,
      at: new Date().toISOString(),
      previousPlan: current.plan,
      nextPlan: normalizedPlan
    };
    const settings = appendLifecycleEvent(current.settings, event);

    const updateResult = await client.query<TenantRow>(
      `UPDATE tenants
       SET plan = $2, settings = $3::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING id, slug, display_name, status::text, plan, settings,
                 created_at::text, updated_at::text`,
      [tenantId, normalizedPlan, JSON.stringify(settings)]
    );

    updatedTenant = mapTenant(updateResult.rows[0]);
    auditData = {
      reason: reason ?? null,
      previousPlan: current.plan,
      plan: normalizedPlan
    };
    await recordAuditLogWithClient(client, {
      tenantId,
      actorUserId: actorUserId ?? null,
      action: "tenant_plan_changed",
      entityType: "tenant",
      entityId: tenantId,
      data: auditData
    });

    await client.query("COMMIT");
    committed = true;
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }

  if (!updatedTenant) {
    throw new TenantLifecycleError("Tenant update did not return a row", "TENANT_NOT_FOUND", 404);
  }
  return updatedTenant;
}

/**
 * Fail-closed runtime gate used before new module usage, provider calls, or billable work.
 */
export async function assertTenantRuntimeActive(tenantId: string): Promise<TenantRecord> {
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    throw new TenantLifecycleError("Tenant not found", "TENANT_NOT_FOUND", 404);
  }
  if (tenant.status === "suspended") {
    throw new TenantLifecycleError(
      "Tenant is suspended. New usage is blocked.",
      "TENANT_SUSPENDED",
      403
    );
  }
  if (tenant.status === "closed") {
    throw new TenantLifecycleError(
      "Tenant is closed. Runtime access is disabled.",
      "TENANT_CLOSED",
      403
    );
  }
  return tenant;
}

/**
 * Get a tenant by ID.
 */
export async function getTenantById(tenantId: string): Promise<TenantRecord | null> {
  const result = await db.query<{
    id: string;
    slug: string;
    display_name: string;
    status: TenantStatus;
    plan: string;
    settings: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, slug, display_name, status::text, plan, settings,
            created_at::text, updated_at::text
     FROM tenants WHERE id = $1`,
    [tenantId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return mapTenant(row);
}

/**
 * Get a tenant by slug.
 */
export async function getTenantBySlug(slug: string): Promise<TenantRecord | null> {
  const result = await db.query<{
    id: string;
    slug: string;
    display_name: string;
    status: TenantStatus;
    plan: string;
    settings: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, slug, display_name, status::text, plan, settings,
            created_at::text, updated_at::text
     FROM tenants WHERE slug = $1`,
    [slug]
  );

  const row = result.rows[0];
  if (!row) return null;

  return mapTenant(row);
}

/**
 * List all tenants. Internal admin only.
 */
export async function listTenants(filters?: {
  status?: TenantStatus;
  limit?: number;
}): Promise<TenantRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}::tenant_status`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters?.limit ?? 100, 500);
  params.push(limit);

  const result = await db.query<{
    id: string;
    slug: string;
    display_name: string;
    status: TenantStatus;
    plan: string;
    settings: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, slug, display_name, status::text, plan, settings,
            created_at::text, updated_at::text
     FROM tenants ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows.map((row) => mapTenant(row));
}

// -------------------------------------------------------------------------
// Plan defaults
// -------------------------------------------------------------------------

import { getPlanTier } from "./catalog";

function planModuleDefaults(plan: string): string[] {
  return getPlanTier(plan).features.includedModules;
}
