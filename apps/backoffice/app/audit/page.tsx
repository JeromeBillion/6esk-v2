import {
  AuditPanel,
  BackofficeFrame,
  Metric,
  Panel,
  formatNumber,
  getBackofficePageData
} from "../_components/work-ui";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const result = await getBackofficePageData();
  if (!result.ok) return result.node;

  const { user, auditLogs } = result.data;
  const tenantScoped = auditLogs.filter((log) => log.tenantId).length;
  const global = auditLogs.length - tenantScoped;

  return (
    <BackofficeFrame
      user={user}
      active="/audit"
      eyebrow="Audit and evidence"
      title="Trust the operating record."
      subtitle="Recent internal, tenant, billing, lifecycle, security, workflow, and support actions with enough structure to investigate what happened."
      badge={<span className={styles.badge}>{formatNumber(auditLogs.length)} recent</span>}
    >
      <div className={styles.grid}>
        <section className={styles.metrics}>
          <Metric label="Recent events" value={formatNumber(auditLogs.length)} detail="Latest audit preview rows" />
          <Metric label="Tenant-scoped" value={formatNumber(tenantScoped)} detail="Events attached to a tenant boundary" />
          <Metric label="Global" value={formatNumber(global)} detail="Platform-level or unscoped events" />
          <Metric label="Evidence posture" value="Reviewable" detail="Mutation history should be auditable before launch" />
        </section>

        <Panel
          title="Audit feed"
          subtitle="The latest evidence rows across backoffice workflows, lifecycle, security, billing, and tenant operations."
          badge={<span className={styles.badge}>Append-only posture</span>}
        >
          <AuditPanel auditLogs={auditLogs} />
        </Panel>
      </div>
    </BackofficeFrame>
  );
}
