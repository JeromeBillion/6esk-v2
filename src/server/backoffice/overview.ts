import { db } from "@/server/db";
import { getOpsHealthSnapshot } from "@/server/ops/health";
import { getSecurityReadinessSnapshot } from "@/server/security/readiness";
import { getTenantMarginSnapshot } from "@/server/billing/margin";

type TenantCountRow = {
  status: string;
  count: string | number;
};

function toNumber(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getBackofficeOverview(input: { tenantId: string }) {
  const [tenantCountsResult, ops, security, margin] = await Promise.all([
    db.query<TenantCountRow>(
      `SELECT status::text AS status, COUNT(*)::bigint AS count
       FROM tenants
       GROUP BY status`
    ),
    getOpsHealthSnapshot({ tenantId: input.tenantId }),
    getSecurityReadinessSnapshot(),
    getTenantMarginSnapshot({ tenantId: input.tenantId, windowDays: 30 })
  ]);

  const counts = {
    active: 0,
    suspended: 0,
    closed: 0
  };

  for (const row of tenantCountsResult.rows) {
    if (row.status === "active" || row.status === "suspended" || row.status === "closed") {
      counts[row.status] = toNumber(row.count);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    tenantScope: input.tenantId,
    tenants: counts,
    operations: ops,
    security,
    finance: margin
  };
}
