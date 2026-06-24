import WorkflowActions from "../WorkflowActions";
import {
  BackofficeFrame,
  CaseList,
  Metric,
  Panel,
  ProfileList,
  badgeClass,
  formatNumber,
  getBackofficePageData
} from "../_components/work-ui";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const result = await getBackofficePageData();
  if (!result.ok) return result.node;

  const { user, cases, profiles, tenants } = result.data;
  const urgent = cases.filter((item) => item.priority === "p0" || item.priority === "p1").length;
  const waiting = cases.filter((item) => item.status.includes("waiting")).length;

  return (
    <BackofficeFrame
      user={user}
      active="/workflows"
      eyebrow="BizOps workflows"
      title="Keep tenant work out of ad hoc docs."
      subtitle="Tenant-linked cases for onboarding, implementation, legal, security questionnaires, incidents, renewals, deliverability, and partner services."
      badge={<span className={badgeClass(urgent > 0 ? "danger" : "good")}>{formatNumber(urgent)} urgent</span>}
    >
      <div className={styles.grid}>
        <section className={styles.metrics}>
          <Metric label="Visible cases" value={formatNumber(cases.length)} detail="Latest tenant-linked workflow cases" />
          <Metric label="Urgent" value={formatNumber(urgent)} detail="P0 or P1 work requiring fast response" />
          <Metric label="Waiting" value={formatNumber(waiting)} detail="Waiting on customer or 6esk" />
          <Metric label="Tenant profiles" value={formatNumber(profiles.length)} detail="Success and security profiles available" />
        </section>

        <section className={styles.twoCol}>
          <WorkflowActions tenants={tenants} />
          <Panel
            title="Tenant success profiles"
            subtitle="Use profile state to decide whether a case is implementation, security, renewal, or risk work."
            badge={<span className={styles.badge}>{formatNumber(profiles.length)} profiles</span>}
          >
            <ProfileList profiles={profiles} limit={10} />
          </Panel>
        </section>

        <Panel
          title="Workflow case queue"
          subtitle="One place for tenant-linked work and follow-up."
          badge={<span className={styles.badge}>{formatNumber(cases.length)} cases</span>}
        >
          <CaseList cases={cases} />
        </Panel>
      </div>
    </BackofficeFrame>
  );
}
