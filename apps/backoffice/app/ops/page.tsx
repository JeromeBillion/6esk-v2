import {
  BackofficeFrame,
  Metric,
  OpsPanel,
  Panel,
  badgeClass,
  formatNumber,
  getBackofficePageData
} from "../_components/work-ui";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const result = await getBackofficePageData();
  if (!result.ok) return result.node;

  const { user, overview } = result.data;
  const queues = overview.operations.queues;
  const failedOutbox = overview.security.operations.failedOutbox.total;

  return (
    <BackofficeFrame
      user={user}
      active="/ops"
      eyebrow="Ops and incidents"
      title="See provider health before customers feel it."
      subtitle="Operational queue state, failed provider events, Dexter runtime status, and incident-response posture for customer-contact paths."
      badge={<span className={badgeClass(overview.operations.ready ? "good" : "warn")}>{overview.operations.ready ? "Ready" : "Attention"}</span>}
    >
      <div className={styles.grid}>
        <section className={styles.metrics}>
          <Metric label="Failed outbox" value={formatNumber(failedOutbox)} detail="Customer-contact delivery failures" />
          <Metric label="Email failed" value={formatNumber(queues.email.failed ?? 0)} detail="Email queue failures" />
          <Metric label="WhatsApp failed" value={formatNumber(queues.whatsapp.failed ?? 0)} detail="WhatsApp queue failures" />
          <Metric label="Voice failed" value={formatNumber(queues.calls.failed ?? 0)} detail="Voice/call queue failures" />
        </section>

        <section className={styles.twoCol}>
          <Panel
            title="Queue and runtime health"
            subtitle="Provider queues and Dexter runtime status from the current operating snapshot."
            badge={<span className={badgeClass(overview.operations.ready ? "good" : "warn")}>{overview.operations.ready ? "Clear" : "Review"}</span>}
          >
            <OpsPanel overview={overview} />
          </Panel>
          <Panel
            title="Incident operating model"
            subtitle="Ops should expose what broke, who is affected, and what action is needed."
            badge={<span className={styles.badge}>Runbook</span>}
          >
            <div className={styles.requirementGrid}>
              <div className={styles.requirementItem}>
                <h3 className={styles.itemTitle}>Detect</h3>
                <p className={styles.itemMeta}>Watch queue failures, provider retries, dead letters, and runtime readiness.</p>
              </div>
              <div className={styles.requirementItem}>
                <h3 className={styles.itemTitle}>Contain</h3>
                <p className={styles.itemMeta}>Use tenant lifecycle and module controls when a tenant or provider path becomes unsafe.</p>
              </div>
              <div className={styles.requirementItem}>
                <h3 className={styles.itemTitle}>Recover</h3>
                <p className={styles.itemMeta}>Open workflow cases for incident follow-up, evidence, and customer communication.</p>
              </div>
            </div>
          </Panel>
        </section>
      </div>
    </BackofficeFrame>
  );
}
