import { headers } from "next/headers";
import type { SessionUser } from "@6esk/auth";
import type { BackofficeAuditPreview } from "@/server/backoffice/audit-preview";
import { listBackofficeAuditPreview } from "@/server/backoffice/audit-preview";
import { requireBackofficeStaff } from "@/server/backoffice/authz";
import { getBackofficeOverview } from "@/server/backoffice/overview";
import {
  listBackofficeCases,
  listTenantBackofficeProfiles
} from "@/server/backoffice/workflows";
import { listTenants } from "@/server/tenant/lifecycle";
import type { BackofficeCase, TenantBackofficeProfile } from "@6esk/types/backoffice";

export type Overview = Awaited<ReturnType<typeof getBackofficeOverview>>;

export type TenantOption = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  plan?: string;
};

export type BackofficePageData = {
  user: SessionUser;
  overview: Overview;
  cases: BackofficeCase[];
  profiles: TenantBackofficeProfile[];
  tenants: TenantOption[];
  auditLogs: BackofficeAuditPreview[];
};

export async function loadBackofficeData(userTenantId: string) {
  const [overview, cases, profiles, tenants, auditLogs] = await Promise.all([
    getBackofficeOverview({ tenantId: userTenantId }),
    listBackofficeCases({ limit: 50 }),
    listTenantBackofficeProfiles({ limit: 200 }),
    listTenants({ limit: 500 }),
    listBackofficeAuditPreview({ limit: 40 })
  ]);
  return {
    overview,
    cases,
    profiles,
    tenants: tenants.map<TenantOption>((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      displayName: tenant.displayName,
      status: tenant.status,
      plan: tenant.plan
    })),
    auditLogs
  };
}

export async function getAuthorizedBackofficePageData(): Promise<
  | { ok: true; data: BackofficePageData }
  | { ok: false; reason: "unauthorized" | "load_failed"; message: string }
> {
  const auth = await requireBackofficeStaff(await headers());
  if (!auth.ok) {
    return {
      ok: false,
      reason: "unauthorized",
      message: "6esk Work requires a valid internal staff session that matches the production ingress identity."
    };
  }

  try {
    const data = await loadBackofficeData(auth.user.tenant_id);
    return {
      ok: true,
      data: {
        user: auth.user,
        ...data
      }
    };
  } catch (error) {
    return {
      ok: false,
      reason: "load_failed",
      message: error instanceof Error ? error.message : "Backoffice data could not be loaded."
    };
  }
}
