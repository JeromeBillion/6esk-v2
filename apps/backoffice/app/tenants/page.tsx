import TenantManagementActions from "../TenantManagementActions";
import {
  BackofficeFrame,
  Metric,
  Panel,
  ProfileList,
  TenantList,
  badgeClass,
  formatNumber,
  getBackofficePageData
} from "../_components/work-ui";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const result = await getBackofficePageData();
  if (!result.ok) return result.node;

  const { user, overview, tenants, profiles, cases } = result.data;
  const onboardingCases = cases.filter((item) =>
    ["onboarding", "implementation", "contract", "security_questionnaire"].includes(item.caseType)
  ).length;
  const elevatedProfiles = profiles.filter((profile) =>
    ["elevated", "critical"].includes(profile.riskTier) ||
    ["watch", "blocked"].includes(profile.securityStatus)
  ).length;

  return (
    <BackofficeFrame
      user={user}
      active="/tenants"
      eyebrow="Tenant lifecycle"
      title="Manage tenants from first hello to offboarding."
      subtitle="This page owns tenant onboarding, lifecycle status, plan alignment, implementation posture, risk state, and offboarding controls."
      badge={<span className={badgeClass(overview.tenants.suspended > 0 ? "warn" : "good")}>{formatNumber(tenants.length)} tenants</span>}
    >
      <div className={styles.grid}>
        <section className={styles.metrics}>
          <Metric label="Active" value={formatNumber(overview.tenants.active)} detail="Runtime-enabled customer workspaces" />
          <Metric label="Suspended" value={formatNumber(overview.tenants.suspended)} detail="Writes and new billable usage blocked" />
          <Metric label="Closed" value={formatNumber(overview.tenants.closed)} detail="Terminal lifecycle state" />
          <Metric label="Implementation work" value={formatNumber(onboardingCases)} detail="Open onboarding, contract, or security cases" />
        </section>

        <TenantManagementActions tenants={tenants} />

        <section className={styles.twoCol}>
          <Panel
            title="Tenant registry"
            subtitle="Operational view of tenant status, slug, plan, and implementation stage."
            badge={<span className={styles.badge}>{formatNumber(tenants.length)} total</span>}
          >
            <TenantList tenants={tenants} profiles={profiles} />
          </Panel>
          <Panel
            title="Success and risk profiles"
            subtitle="Internal customer-success posture, renewal state, risk tier, and security readiness."
            badge={<span className={badgeClass(elevatedProfiles > 0 ? "warn" : "good")}>{formatNumber(elevatedProfiles)} elevated</span>}
          >
            <ProfileList profiles={profiles} />
          </Panel>
        </section>

        <Panel
          title="Tenant experience requirements"
          subtitle="The tenant page should make the customer relationship operable without hunting across support, billing, security, and implementation tools."
          badge={<span className={styles.badge}>UX contract</span>}
        >
          <div className={styles.requirementGrid}>
            <div className={styles.requirementItem}>
              <h3 className={styles.itemTitle}>Onboarding clarity</h3>
              <p className={styles.itemMeta}>Provisioning, plan, module entitlements, implementation stage, security questionnaire, and launch blockers should be visible together.</p>
            </div>
            <div className={styles.requirementItem}>
              <h3 className={styles.itemTitle}>Lifecycle confidence</h3>
              <p className={styles.itemMeta}>Suspension, reactivation, plan changes, and closure need reason capture, MFA/privileged access, and audit evidence.</p>
            </div>
            <div className={styles.requirementItem}>
              <h3 className={styles.itemTitle}>Commercial context</h3>
              <p className={styles.itemMeta}>Support staff should see plan, renewal date, billing posture, enabled modules, and active workflow cases before taking action.</p>
            </div>
            <div className={styles.requirementItem}>
              <h3 className={styles.itemTitle}>Safe offboarding</h3>
              <p className={styles.itemMeta}>Closed tenants are terminal, runtime access is disabled, and historical billing/audit records stay intact.</p>
            </div>
          </div>
        </Panel>
      </div>
    </BackofficeFrame>
  );
}
