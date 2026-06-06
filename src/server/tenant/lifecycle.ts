/**
 * Tenant lifecycle operations.
 *
 * Covers provisioning, suspension, closure, and status management
 * for the multi-tenant SaaS platform.
 */

import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";
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

    await client.query("COMMIT");

    // 5. Audit
    await recordAuditLog({
      tenantId: tenant.id,
      actorUserId: actorUserId ?? null,
      action: "tenant_provisioned",
      entityType: "tenant",
      entityId: tenant.id,
      data: { slug, plan, displayName }
    });

    return {
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.display_name,
      status: tenant.status,
      plan: tenant.plan,
      settings: tenant.settings,
      createdAt: tenant.created_at,
      updatedAt: tenant.updated_at
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Suspend a tenant. Read-only access remains, writes are blocked.
 */
export async function suspendTenant(tenantId: string, reason: string, actorUserId?: string | null) {
  await db.query(
    `UPDATE tenants SET status = 'suspended', updated_at = now() WHERE id = $1`,
    [tenantId]
  );

  await recordAuditLog({
    tenantId,
    actorUserId: actorUserId ?? null,
    action: "tenant_suspended",
    entityType: "tenant",
    entityId: tenantId,
    data: { reason }
  });
}

/**
 * Reactivate a suspended tenant.
 */
export async function reactivateTenant(tenantId: string, actorUserId?: string | null) {
  await db.query(
    `UPDATE tenants SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'suspended'`,
    [tenantId]
  );

  await recordAuditLog({
    tenantId,
    actorUserId: actorUserId ?? null,
    action: "tenant_reactivated",
    entityType: "tenant",
    entityId: tenantId,
    data: {}
  });
}

/**
 * Close a tenant. All access is disabled.
 */
export async function closeTenant(tenantId: string, reason: string, actorUserId?: string | null) {
  await db.query(
    `UPDATE tenants SET status = 'closed', updated_at = now() WHERE id = $1`,
    [tenantId]
  );

  await recordAuditLog({
    tenantId,
    actorUserId: actorUserId ?? null,
    action: "tenant_closed",
    entityType: "tenant",
    entityId: tenantId,
    data: { reason }
  });
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

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    plan: row.plan,
    settings: row.settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    plan: row.plan,
    settings: row.settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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

  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    plan: row.plan,
    settings: row.settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

// -------------------------------------------------------------------------
// Plan defaults
// -------------------------------------------------------------------------

import { getPlanTier } from "./catalog";

function planModuleDefaults(plan: string): string[] {
  return getPlanTier(plan).features.includedModules;
}
