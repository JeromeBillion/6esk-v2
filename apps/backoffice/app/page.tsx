import {
  Activity,
  Banknote,
  Building2,
  FileLock2,
  Gauge,
  LifeBuoy,
  Shield,
  Workflow
} from "lucide-react";
import { getSessionUser, isInternalStaff } from "@6esk/auth";
import { listBackofficeAuditPreview } from "@/server/backoffice/audit-preview";
import { getBackofficeOverview } from "@/server/backoffice/overview";
import {
  listBackofficeCases,
  listTenantBackofficeProfiles
} from "@/server/backoffice/workflows";
import { listTenants } from "@/server/tenant/lifecycle";
import type { BackofficeCase, TenantBackofficeProfile } from "@6esk/types/backoffice";
import type { BackofficeAuditPreview } from "@/server/backoffice/audit-preview";
import BackofficeActions, { type TenantOption } from "./BackofficeActions";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

type Overview = Awaited<ReturnType<typeof getBackofficeOverview>>;

function formatNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? new Intl.NumberFormat("en-ZA").format(numeric) : "0";
}

function formatMoneyCent(value: unknown) {
  const numeric = Number(value);
  const amount = Number.isFinite(numeric) ? numeric / 100 : 0;
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0
  }).format(amount);
}

function shortDate(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return new Intl.DateTimeFormat("en-ZA", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function badgeClass(tone: "neutral" | "good" | "warn" | "danger") {
  if (tone === "good") return `${styles.badge} ${styles.badgeGood}`;
  if (tone === "warn") return `${styles.badge} ${styles.badgeWarn}`;
  if (tone === "danger") return `${styles.badge} ${styles.badgeDanger}`;
  return styles.badge;
}

function priorityTone(priority: BackofficeCase["priority"]) {
  if (priority === "p0" || priority === "p1") return "danger";
  if (priority === "p2") return "warn";
  return "neutral";
}

function profileTone(profile: TenantBackofficeProfile) {
  if (profile.securityStatus === "blocked" || profile.riskTier === "critical") return "danger";
  if (profile.securityStatus === "watch" || profile.riskTier === "elevated") return "warn";
  if (profile.securityStatus === "ready" || profile.riskTier === "low") return "good";
  return "neutral";
}

async function loadBackofficeData(userTenantId: string) {
  const [overview, cases, profiles, tenants, auditLogs] = await Promise.all([
    getBackofficeOverview({ tenantId: userTenantId }),
    listBackofficeCases({ limit: 8 }),
    listTenantBackofficeProfiles({ limit: 8 }),
    listTenants({ limit: 100 }),
    listBackofficeAuditPreview({ limit: 12 })
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

function AccessState({
  title,
  message
}: {
  title: string;
  message: string;
}) {
  const loginHref = `${process.env.WEB_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000"}/login`;
  return (
    <main className={styles.accessShell}>
      <section className={styles.accessBox}>
        <p className={styles.eyebrow}>6esk Work</p>
        <h1>{title}</h1>
        <p>{message}</p>
        <a className={styles.accessLink} href={loginHref}>
          Open sign-in
        </a>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={styles.metric}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={styles.metricValue}>{value}</p>
      <p className={styles.metricDetail}>{detail}</p>
    </div>
  );
}

function CaseList({ cases }: { cases: BackofficeCase[] }) {
  if (cases.length === 0) {
    return <div className={styles.empty}>No open internal workflow cases.</div>;
  }

  return (
    <div className={styles.caseList}>
      {cases.map((item) => (
        <article className={styles.caseItem} key={item.id}>
          <div className={styles.itemTop}>
            <div>
              <h3 className={styles.itemTitle}>{item.title}</h3>
              <p className={styles.itemMeta}>
                {item.tenantDisplayName} · {item.caseType.replaceAll("_", " ")} · {shortDate(item.dueAt)}
              </p>
            </div>
            <span className={badgeClass(priorityTone(item.priority))}>{item.priority.toUpperCase()}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ProfileList({ profiles }: { profiles: TenantBackofficeProfile[] }) {
  if (profiles.length === 0) {
    return <div className={styles.empty}>No tenant backoffice profiles yet.</div>;
  }

  return (
    <div className={styles.profileList}>
      {profiles.map((profile) => (
        <article className={styles.profileItem} key={profile.tenantId}>
          <div className={styles.itemTop}>
            <div>
              <h3 className={styles.itemTitle}>{profile.tenantDisplayName}</h3>
              <p className={styles.itemMeta}>
                {profile.implementationStage.replaceAll("_", " ")} · renewal {shortDate(profile.renewalDate)}
              </p>
            </div>
            <span className={badgeClass(profileTone(profile))}>{profile.riskTier}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function TenantList({ tenants }: { tenants: TenantOption[] }) {
  if (tenants.length === 0) {
    return <div className={styles.empty}>No tenants are provisioned yet.</div>;
  }

  return (
    <div className={styles.tableList}>
      {tenants.slice(0, 12).map((tenant) => (
        <article className={styles.tableRow} key={tenant.id}>
          <div>
            <h3 className={styles.itemTitle}>{tenant.displayName}</h3>
            <p className={styles.itemMeta}>{tenant.slug} · {tenant.plan ?? "plan unset"}</p>
          </div>
          <span className={badgeClass(tenant.status === "active" ? "good" : tenant.status === "suspended" ? "warn" : "danger")}>
            {tenant.status}
          </span>
        </article>
      ))}
    </div>
  );
}

function FinancePanel({ overview }: { overview: Overview }) {
  const modules = overview.finance.modules.slice(0, 8);
  return (
    <div className={styles.splitRows}>
      <div className={styles.statLine}>
        <span>Estimated revenue</span>
        <strong>{formatMoneyCent(overview.finance.totals.estimatedRevenueCent)}</strong>
      </div>
      <div className={styles.statLine}>
        <span>Provider cost</span>
        <strong>{formatMoneyCent(overview.finance.totals.costCent)}</strong>
      </div>
      <div className={styles.statLine}>
        <span>Estimated margin</span>
        <strong>{formatMoneyCent(overview.finance.totals.estimatedMarginCent)}</strong>
      </div>
      {modules.length ? (
        modules.map((module) => (
          <div className={styles.statLine} key={module.moduleKey}>
            <span>{module.moduleKey}</span>
            <strong>{formatMoneyCent(module.estimatedMarginCent)}</strong>
          </div>
        ))
      ) : (
        <div className={styles.empty}>No usage margin events in the current window.</div>
      )}
    </div>
  );
}

function SecurityPanel({ overview }: { overview: Overview }) {
  return (
    <div className={styles.checkList}>
      {overview.security.checks.map((check) => (
        <div className={styles.checkItem} key={check.key}>
          <span className={badgeClass(check.ok ? "good" : "danger")}>{check.ok ? "Pass" : "Review"}</span>
          <div>
            <h3 className={styles.itemTitle}>{check.key.replaceAll("_", " ")}</h3>
            <p className={styles.itemMeta}>{check.detail}</p>
          </div>
        </div>
      ))}
      <div className={styles.statLine}>
        <span>Active impersonations</span>
        <strong>{formatNumber(overview.security.operations.activeImpersonations)}</strong>
      </div>
      <div className={styles.statLine}>
        <span>Privileged grants needing review</span>
        <strong>{formatNumber(overview.security.operations.privilegedAccessGrantsNeedingReview)}</strong>
      </div>
    </div>
  );
}

function OpsPanel({ overview }: { overview: Overview }) {
  const queues = overview.operations.queues;
  const runtime = overview.operations.runtime.dexter;
  return (
    <div className={styles.splitRows}>
      <div className={styles.statLine}>
        <span>Email queue failed</span>
        <strong>{formatNumber(queues.email.failed ?? 0)}</strong>
      </div>
      <div className={styles.statLine}>
        <span>WhatsApp queue failed</span>
        <strong>{formatNumber(queues.whatsapp.failed ?? 0)}</strong>
      </div>
      <div className={styles.statLine}>
        <span>Calls queue failed</span>
        <strong>{formatNumber(queues.calls.failed ?? 0)}</strong>
      </div>
      <div className={styles.statLine}>
        <span>Dexter runtime</span>
        <strong>{runtime.state}</strong>
      </div>
    </div>
  );
}

function AuditPanel({ auditLogs }: { auditLogs: BackofficeAuditPreview[] }) {
  if (auditLogs.length === 0) {
    return <div className={styles.empty}>No audit activity has been recorded yet.</div>;
  }
  return (
    <div className={styles.tableList}>
      {auditLogs.map((log) => (
        <article className={styles.tableRow} key={log.id}>
          <div>
            <h3 className={styles.itemTitle}>{log.action}</h3>
            <p className={styles.itemMeta}>
              {log.entityType}{log.actorEmail ? ` · ${log.actorEmail}` : ""} · {shortDate(log.createdAt)}
            </p>
          </div>
          <span className={styles.badge}>{log.tenantId ? "tenant" : "global"}</span>
        </article>
      ))}
    </div>
  );
}

function ModuleGrid({ overview }: { overview: Overview }) {
  const failedOutbox = overview.security.operations.failedOutbox.total;
  const modules = [
    {
      icon: Building2,
      title: "Tenants",
      detail: `${formatNumber(overview.tenants.active)} active · ${formatNumber(overview.tenants.suspended)} suspended`
    },
    {
      icon: Banknote,
      title: "Billing & finance",
      detail: `${formatMoneyCent(overview.finance.totals.estimatedRevenueCent)} estimated revenue`
    },
    {
      icon: Shield,
      title: "Security & access",
      detail: `${formatNumber(overview.security.operations.activePrivilegedAccessGrants)} active grants`
    },
    {
      icon: Activity,
      title: "Ops & incidents",
      detail: failedOutbox === 0 ? "No failed outbox events" : `${formatNumber(failedOutbox)} failed outbox events`
    },
    {
      icon: Workflow,
      title: "BizOps workflows",
      detail: "Onboarding, renewals, legal, deliverability, and partner work"
    },
    {
      icon: FileLock2,
      title: "Evidence",
      detail: "Security packs, contracts, DPAs, provider links, and R2 artifacts"
    },
    {
      icon: Gauge,
      title: "Usage posture",
      detail: `${formatNumber(overview.finance.totals.events)} billable events in the current window`
    },
    {
      icon: LifeBuoy,
      title: "Support control",
      detail: "Privileged access, impersonation review, and escalation state"
    }
  ];

  return (
    <div className={styles.moduleGrid}>
      {modules.map((module) => {
        const Icon = module.icon;
        return (
          <article className={styles.module} key={module.title}>
            <div className={styles.iconBox}>
              <Icon size={18} aria-hidden="true" />
            </div>
            <h3 className={styles.moduleTitle}>{module.title}</h3>
            <p className={styles.moduleDetail}>{module.detail}</p>
          </article>
        );
      })}
    </div>
  );
}

export default async function BackofficeHome() {
  const user = await getSessionUser();
  if (!user) {
    return (
      <AccessState
        title="Internal session required"
        message="6esk Work is only available after signing in with an internal 6esk staff account."
      />
    );
  }

  if (!isInternalStaff(user)) {
    return (
      <AccessState
        title="Internal staff only"
        message="This workspace is isolated from tenant administration and is not available to customer users."
      />
    );
  }

  let data: Awaited<ReturnType<typeof loadBackofficeData>>;
  try {
    data = await loadBackofficeData(user.tenant_id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backoffice data could not be loaded.";
    return (
      <AccessState
        title="Backoffice data unavailable"
        message={message}
      />
    );
  }

  const { overview, cases, profiles, tenants, auditLogs } = data;
  const healthTone = overview.operations.ready && overview.security.healthy ? "good" : "warn";

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>6</div>
          <div>
            <p className={styles.brandTitle}>6esk Work</p>
            <p className={styles.brandSub}>Internal SaaS operations</p>
          </div>
        </div>
        <nav className={styles.nav} aria-label="6esk Work sections">
          {["Overview", "Tenants", "Billing", "Security", "Ops", "BizOps", "Audit"].map((item) => (
            <a className={styles.navItem} href={`#${item.toLowerCase()}`} key={item}>
              <strong>{item}</strong>
              <span>Open</span>
            </a>
          ))}
        </nav>
        <div className={styles.operatorBox}>
          <p className={styles.operatorLabel}>Signed in</p>
          <p className={styles.operatorEmail}>{user.email}</p>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Internal control plane</p>
            <h1 className={styles.title}>Run the business side of 6esk.</h1>
            <p className={styles.subtitle}>
              Tenant lifecycle, finance, security, incidents, implementation, legal, provider ownership, and audit posture in one dark-only internal workspace.
            </p>
          </div>
          <span className={badgeClass(healthTone)}>
            <span className={styles.statusDot} />
            {overview.operations.ready ? "Ops ready" : "Ops attention"}
          </span>
        </header>

        <div className={styles.grid}>
          <section className={styles.metrics} id="overview">
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
              label="Estimated margin"
              value={formatMoneyCent(overview.finance.totals.estimatedMarginCent)}
              detail={`${formatNumber(overview.finance.totals.estimatedMarginPct)}% margin signal`}
            />
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.panelTitle}>Operating modules</h2>
                <p className={styles.panelSub}>The first-pass 6esk Work IA aligned to the v2 roadmap.</p>
              </div>
              <span className={styles.badge}>Dark-only</span>
            </div>
            <ModuleGrid overview={overview} />
          </section>

          <BackofficeActions tenants={tenants} />

          <section className={styles.twoCol}>
            <div className={styles.panel} id="tenants">
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Tenants</h2>
                  <p className={styles.panelSub}>Provisioning, lifecycle, plan, and current tenant status.</p>
                </div>
                <span className={styles.badge}>{formatNumber(tenants.length)} total</span>
              </div>
              <TenantList tenants={tenants} />
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Tenant profiles</h2>
                  <p className={styles.panelSub}>Implementation, risk, security, owner, and renewal posture.</p>
                </div>
                <span className={styles.badge}>{formatNumber(profiles.length)} profiles</span>
              </div>
              <ProfileList profiles={profiles} />
            </div>
          </section>

          <section className={styles.twoCol}>
            <div className={styles.panel} id="billing">
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Billing and finance</h2>
                  <p className={styles.panelSub}>Margin signal from tenant-scoped module usage events.</p>
                </div>
                <span className={styles.badge}>{overview.finance.windowDays} days</span>
              </div>
              <FinancePanel overview={overview} />
            </div>

            <div className={styles.panel} id="security">
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Security and access</h2>
                  <p className={styles.panelSub}>Production gate checks and privileged access posture.</p>
                </div>
                <span className={badgeClass(overview.security.healthy ? "good" : "danger")}>
                  {overview.security.healthy ? "Ready" : "Review"}
                </span>
              </div>
              <SecurityPanel overview={overview} />
            </div>
          </section>

          <section className={styles.twoCol}>
            <div className={styles.panel} id="ops">
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Ops and incidents</h2>
                  <p className={styles.panelSub}>Provider queues, runtime status, and operational readiness.</p>
                </div>
                <span className={badgeClass(overview.operations.ready ? "good" : "warn")}>
                  {overview.operations.ready ? "Ready" : "Attention"}
                </span>
              </div>
              <OpsPanel overview={overview} />
            </div>

            <div className={styles.panel} id="audit">
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Audit</h2>
                  <p className={styles.panelSub}>Latest internal, tenant, billing, security, and workflow actions.</p>
                </div>
                <span className={styles.badge}>{formatNumber(auditLogs.length)} recent</span>
              </div>
              <AuditPanel auditLogs={auditLogs} />
            </div>
          </section>

          <section className={styles.twoCol}>
            <div className={styles.panel} id="bizops">
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Workflow cases</h2>
                  <p className={styles.panelSub}>Cross-functional SaaS work queues linked to tenant boundaries.</p>
                </div>
                <span className={styles.badge}>{formatNumber(cases.length)} visible</span>
              </div>
              <CaseList cases={cases} />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
