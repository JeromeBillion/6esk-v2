import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireBackofficeSensitiveAccess,
  requireBackofficeStaff
} from "@/server/backoffice/authz";
import { isDemoModeEnabled } from "@/app/lib/demo-mode";
import {
  changeTenantPlan,
  TenantLifecycleError,
  provisionTenant,
  suspendTenant,
  reactivateTenant,
  closeTenant,
  listTenants,
  type TenantStatus
} from "@/server/tenant";

// -----------------------------------------------------------------------
// GET /api/admin/tenants — list all tenants (internal admin only)
// -----------------------------------------------------------------------
export async function GET(request: Request) {
  if (isDemoModeEnabled()) {
    return NextResponse.json({
      tenants: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          slug: "default",
          displayName: "6esk Default Tenant",
          status: "active",
          plan: "enterprise",
          settings: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });
  }

  const auth = await requireBackofficeStaff(request.headers);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") as TenantStatus | null;

  const tenants = await listTenants({ status: status ?? undefined });
  return NextResponse.json({ tenants });
}

// -----------------------------------------------------------------------
// POST /api/admin/tenants — provision a new tenant
// -----------------------------------------------------------------------
const provisionSchema = z.object({
  slug: z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  displayName: z.string().min(1).max(200),
  plan: z.enum(["starter", "professional", "enterprise"]).optional()
});

export async function POST(request: Request) {
  if (isDemoModeEnabled()) {
    return NextResponse.json({ error: "Not available in demo mode" }, { status: 400 });
  }

  const auth = await requireBackofficeSensitiveAccess(request.headers);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = provisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const tenant = await provisionTenant({
      slug: parsed.data.slug,
      displayName: parsed.data.displayName,
      plan: parsed.data.plan ?? "starter",
      actorUserId: auth.user.id
    });
    return NextResponse.json({ tenant }, { status: 201 });
  } catch (err: any) {
    if (err?.code === "23505") {
      return NextResponse.json(
        { error: "A tenant with this slug already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}

// -----------------------------------------------------------------------
// PATCH /api/admin/tenants — update tenant status (suspend/reactivate/close)
// -----------------------------------------------------------------------
const statusSchema = z.object({
  tenantId: z.string().uuid(),
  action: z.enum(["suspend", "reactivate", "close", "change_plan"]),
  plan: z.string().min(1).max(80).optional(),
  reason: z.string().optional()
});

export async function PATCH(request: Request) {
  if (isDemoModeEnabled()) {
    return NextResponse.json({ error: "Not available in demo mode" }, { status: 400 });
  }

  const auth = await requireBackofficeSensitiveAccess(request.headers);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { tenantId, action, reason } = parsed.data;

  try {
    switch (action) {
      case "suspend":
        await suspendTenant(tenantId, reason ?? "No reason provided", auth.user.id);
        break;
      case "reactivate":
        await reactivateTenant(tenantId, auth.user.id);
        break;
      case "close":
        await closeTenant(tenantId, reason ?? "No reason provided", auth.user.id);
        break;
      case "change_plan":
        if (!parsed.data.plan) {
          return NextResponse.json({ error: "Plan is required" }, { status: 400 });
        }
        await changeTenantPlan({
          tenantId,
          plan: parsed.data.plan,
          reason: reason ?? "No reason provided",
          actorUserId: auth.user.id
        });
        break;
    }
  } catch (err) {
    const status = err instanceof TenantLifecycleError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status }
    );
  }

  return NextResponse.json({ ok: true, tenantId, action });
}
