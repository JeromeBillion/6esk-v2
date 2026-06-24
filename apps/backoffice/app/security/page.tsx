import {
  BackofficeFrame,
  Metric,
  Panel,
  SecurityPanel,
  badgeClass,
  formatNumber,
  getBackofficePageData
} from "../_components/work-ui";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const result = await getBackofficePageData();
  if (!result.ok) return result.node;

  const { user, overview, auditLogs } = result.data;

  return (
    <BackofficeFrame
      user={user}
      active="/security"
      eyebrow="Security and access"
      title="Control internal access with explicit evidence."
      subtitle="Security posture, privileged grants, impersonation state, production gate checks, and recent audit evidence for sensitive SaaS operations."
      badge={<span className={badgeClass(overview.security.healthy ? "good" : "danger")}>{overview.security.healthy ? "Ready" : "Review"}</span>}
    >
      <div className={styles.grid}>
        <section className={styles.metrics}>
          <Metric label="Readiness checks" value={formatNumber(overview.security.checks.length)} detail="Production security gates tracked" />
          <Metric label="Active grants" value={formatNumber(overview.security.operations.activePrivilegedAccessGrants)} detail="Privileged access currently active" />
          <Metric label="Review needed" value={formatNumber(overview.security.operations.privilegedAccessGrantsNeedingReview)} detail="Privileged grants needing attention" />
          <Metric label="Impersonations" value={formatNumber(overview.security.operations.activeImpersonations)} detail="Tenant support sessions in progress" />
        </section>

        <section className={styles.twoCol}>
          <Panel
            title="Security readiness"
            subtitle="Production gate checks and privileged-access operating state."
            badge={<span className={badgeClass(overview.security.healthy ? "good" : "danger")}>{overview.security.healthy ? "Pass" : "Review"}</span>}
          >
            <SecurityPanel overview={overview} />
          </Panel>
          <Panel
            title="Access operating rules"
            subtitle="What staff should be able to tell from this page before touching tenant data."
            badge={<span className={styles.badge}>Policy</span>}
          >
            <div className={styles.requirementGrid}>
              <div className={styles.requirementItem}>
                <h3 className={styles.itemTitle}>Cloudflare Access is ingress</h3>
                <p className={styles.itemMeta}>Business authorization remains app-level staff auth, MFA, privileged grants, and audit logs.</p>
              </div>
              <div className={styles.requirementItem}>
                <h3 className={styles.itemTitle}>Sensitive actions require elevation</h3>
                <p className={styles.itemMeta}>Lifecycle, billing, impersonation, artifact, and workflow mutations should require MFA or an active grant.</p>
              </div>
              <div className={styles.requirementItem}>
                <h3 className={styles.itemTitle}>Tenant data stays bounded</h3>
                <p className={styles.itemMeta}>Backoffice support views can assist tenants without weakening customer or tenant isolation boundaries.</p>
              </div>
            </div>
          </Panel>
        </section>

        <Panel
          title="Recent sensitive evidence"
          subtitle="Latest audit actions visible from the security operating context."
          badge={<span className={styles.badge}>{formatNumber(auditLogs.length)} recent</span>}
        >
          <div className={styles.tableList}>
            {auditLogs.slice(0, 16).map((log) => (
              <article className={styles.tableRow} key={log.id}>
                <div>
                  <h3 className={styles.itemTitle}>{log.action}</h3>
                  <p className={styles.itemMeta}>
                    {log.entityType}{log.actorEmail ? ` · ${log.actorEmail}` : ""}
                  </p>
                </div>
                <span className={styles.badge}>{log.tenantId ? "tenant" : "global"}</span>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    </BackofficeFrame>
  );
}
