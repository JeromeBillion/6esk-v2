import {
  AuditPanel,
  BackofficeFrame,
  CaseList,
  FinancePanel,
  Metric,
  ModuleGrid,
  OperatingRhythm,
  OpsPanel,
  Panel,
  SecurityPanel,
  TenantList,
  badgeClass,
  formatMoneyCent,
  formatNumber,
  getBackofficePageData
} from "../_components/work-ui";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const result = await getBackofficePageData();
  if (!result.ok) return result.node;

  const { user, overview, cases, tenants, profiles, auditLogs } = result.data;
  const healthTone = overview.operations.ready && overview.security.healthy ? "good" : "warn";

  return (
    <BackofficeFrame
      user={user}
      active="/dashboard"
      eyebrow="Dashboards"
      title="Operate the business side of 6esk."
      subtitle="A routed command dashboard for tenant posture, finance, security, provider operations, workflow load, and audit confidence."
      badge={
        <span className={badgeClass(healthTone)}>
          <span className={styles.statusDot} />
          {overview.operations.ready ? "Ops ready" : "Ops attention"}
        </span>
      }
    >
      <div className={styles.grid}>
        <section className={styles.metrics}>
          <Metric
            label="Active tenants"
            value={formatNumber(overview.tenants.active)}
            detail={`${formatNumber(overview.tenants.suspended)} suspended · ${formatNumber(overview.tenants.closed)} closed`}
          />
          <Metric
            label="Security posture"
            value={overview.security.healthy ? "Ready" : "Review"}
            detail={`${formatNumber(overview.security.operations.privilegedAccessGrantsNeedingReview)} access reviews pending`}
          />
          <Metric
            label="Provider queues"
            value={overview.operations.ready ? "Clear" : "Attention"}
            detail={`${formatNumber(overview.security.operations.failedOutbox.total)} failed delivery events`}
          />
          <Metric
            label="Gross P/L"
            value={formatMoneyCent(overview.finance.totals.estimatedMarginCent)}
            detail={`${formatNumber(overview.finance.totals.estimatedMarginPct)}% margin signal`}
          />
        </section>

        <Panel
          title="Operating modules"
          subtitle="Each module now has its own route, owner context, and task-specific information hierarchy."
          badge={<span className={styles.badge}>Routed IA</span>}
        >
          <ModuleGrid overview={overview} />
        </Panel>

        <Panel
          title="Operating rhythm"
          subtitle="The dashboard shows what needs attention first; detailed work happens in the dedicated pages."
          badge={<span className={styles.badge}>Daily run</span>}
        >
          <OperatingRhythm />
        </Panel>

        <section className={styles.twoCol}>
          <Panel
            title="Tenant pulse"
            subtitle="Newest tenant boundaries, plan state, lifecycle state, and success posture."
            badge={<a className={styles.routeLink} href="/tenants">Manage tenants</a>}
          >
            <TenantList tenants={tenants} profiles={profiles} limit={8} />
          </Panel>
          <Panel
            title="Finance pulse"
            subtitle="Current 30-day customer billing estimate, runtime cost, and gross margin signal."
            badge={<a className={styles.routeLink} href="/billing">Open billing</a>}
          >
            <FinancePanel overview={overview} />
          </Panel>
        </section>

        <section className={styles.twoCol}>
          <Panel
            title="Security and access"
            subtitle="Production readiness, privileged access, and impersonation posture."
            badge={<a className={styles.routeLink} href="/security">Review access</a>}
          >
            <SecurityPanel overview={overview} />
          </Panel>
          <Panel
            title="Ops and incidents"
            subtitle="Provider queues, Dexter runtime posture, failed outbox, and operational readiness."
            badge={<a className={styles.routeLink} href="/ops">Open ops</a>}
          >
            <OpsPanel overview={overview} />
          </Panel>
        </section>

        <section className={styles.twoCol}>
          <Panel
            title="Workflow queue"
            subtitle="Tenant-linked work that should not be lost in chat or ad hoc documents."
            badge={<a className={styles.routeLink} href="/workflows">Open workflows</a>}
          >
            <CaseList cases={cases} limit={8} />
          </Panel>
          <Panel
            title="Audit preview"
            subtitle="Recent operational evidence across tenant, security, billing, and workflow changes."
            badge={<a className={styles.routeLink} href="/audit">Open audit</a>}
          >
            <AuditPanel auditLogs={auditLogs} limit={8} />
          </Panel>
        </section>
      </div>
    </BackofficeFrame>
  );
}
