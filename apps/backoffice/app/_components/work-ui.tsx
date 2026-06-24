import {
  Activity,
  Banknote,
  Building2,
  ClipboardList,
  FileClock,
  FileLock2,
  Gauge,
  LifeBuoy,
  Shield,
  Workflow
} from "lucide-react";
import type { ReactNode } from "react";
import { getSessionUser, isInternalStaff } from "@6esk/auth";
import { listBackofficeAuditPreview, type BackofficeAuditPreview } from "@/server/backoffice/audit-preview";
import { getBackofficeOverview } from "@/server/backoffice/overview";
import {
  listBackofficeCases,
  listTenantBackofficeProfiles
} from "@/server/backoffice/workflows";
import { listTenants } from "@/server/tenant/lifecycle";
import type { BackofficeCase, TenantBackofficeProfile } from "@6esk/types/backoffice";
import styles from "../page.module.css";

export type Overview = Awaited<ReturnType<typeof getBackofficeOverview>>;

export type TenantOption = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  plan?: string;
};

export type BackofficePageData = {
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
  overview: Overview;
  cases: BackofficeCase[];
  profiles: TenantBackofficeProfile[];
  tenants: TenantOption[];
  auditLogs: BackofficeAuditPreview[];
};

const NAV_ITEMS = [
  { label: "Dashboards", href: "/dashboard", description: "Overview" },
  { label: "Tenants", href: "/tenants", description: "Lifecycle" },
  { label: "Billing", href: "/billing", description: "P/L" },
  { label: "Security", href: "/security", description: "Access" },
  { label: "Ops", href: "/ops", description: "Incidents" },
  { label: "Workflows", href: "/workflows", description: "BizOps" },
  { label: "Audit", href: "/audit", description: "Evidence" }
];

export function formatNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? new Intl.NumberFormat("en-ZA").format(numeric) : "0";
}

export function formatMoneyCent(value: unknown) {
  const numeric = Number(value);
  const amount = Number.isFinite(numeric) ? numeric / 100 : 0;
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0
  }).format(amount);
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return new Intl.DateTimeFormat("en-ZA", {
    month: "short",
    day: "numeric"
  }).format(date);
}

export function badgeClass(tone: "neutral" | "good" | "warn" | "danger") {
  if (tone === "good") return `${styles.badge} ${styles.badgeGood}`;
  if (tone === "warn") return `${styles.badge} ${styles.badgeWarn}`;
  if (tone === "danger") return `${styles.badge} ${styles.badgeDanger}`;
  return styles.badge;
}

export function statusTone(status: string | null | undefined) {
  if (status === "active" || status === "ready" || status === "launched" || status === "low") {
    return "good";
  }
  if (status === "suspended" || status === "watch" || status === "elevated" || status === "uat") {
    return "warn";
  }
  if (status === "closed" || status === "blocked" || status === "critical") {
    return "danger";
  }
  return "neutral";
}

export function priorityTone(priority: BackofficeCase["priority"]) {
  if (priority === "p0" || priority === "p1") return "danger";
  if (priority === "p2") return "warn";
  return "neutral";
}

export function profileTone(profile: TenantBackofficeProfile) {
  if (profile.securityStatus === "blocked" || profile.riskTier === "critical") return "danger";
  if (profile.securityStatus === "watch" || profile.riskTier === "elevated") return "warn";
  if (profile.securityStatus === "ready" || profile.riskTier === "low") return "good";
  return "neutral";
}

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

export async function getBackofficePageData(): Promise<
  | { ok: true; data: BackofficePageData }
  | { ok: false; node: ReactNode }
> {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      node: (
        <AccessState
          title="Internal session required"
          message="6esk Work is only available after signing in with an internal 6esk staff account."
        />
      )
    };
  }

  if (!isInternalStaff(user)) {
    return {
      ok: false,
      node: (
        <AccessState
          title="Internal staff only"
          message="This workspace is isolated from tenant administration and is not available to customer users."
        />
      )
    };
  }

  try {
    const data = await loadBackofficeData(user.tenant_id);
    return {
      ok: true,
      data: {
        user,
        ...data
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backoffice data could not be loaded.";
    return {
      ok: false,
      node: <AccessState title="Backoffice data unavailable" message={message} />
    };
  }
}

export function AccessState({
  title,
  message
}: {
  title: string;
  message: string;
}) {
  return (
    <main className={styles.accessShell}>
      <section className={styles.accessBox}>
        <p className={styles.eyebrow}>6esk Work</p>
        <h1>{title}</h1>
        <p>{message}</p>
        <a className={styles.accessLink} href="/login?returnTo=/dashboard">
          Open sign-in
        </a>
      </section>
    </main>
  );
}

export function BackofficeFrame({
  user,
  active,
  eyebrow,
  title,
  subtitle,
  badge,
  children
}: {
  user: BackofficePageData["user"];
  active: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/dashboard" aria-label="6esk Work dashboard">
          <div className={styles.brandMark}>6</div>
          <div>
            <p className={styles.brandTitle}>6esk Work</p>
            <p className={styles.brandSub}>Internal SaaS operations</p>
          </div>
        </a>
        <nav className={styles.nav} aria-label="6esk Work sections">
          {NAV_ITEMS.map((item) => (
            <a
              className={`${styles.navItem} ${active === item.href ? styles.navItemActive : ""}`}
              href={item.href}
              key={item.href}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
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
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h1 className={styles.title}>{title}</h1>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
          {badge}
        </header>
        {children}
      </main>
    </div>
  );
}

export function Metric({
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

export function Panel({
  title,
  subtitle,
  badge,
  children,
  className = ""
}: {
  title: string;
  subtitle: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className}`}>
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>{title}</h2>
          <p className={styles.panelSub}>{subtitle}</p>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function CaseList({ cases, limit }: { cases: BackofficeCase[]; limit?: number }) {
  const visible = typeof limit === "number" ? cases.slice(0, limit) : cases;
  if (visible.length === 0) {
    return <div className={styles.empty}>No open internal workflow cases.</div>;
  }

  return (
    <div className={styles.caseList}>
      {visible.map((item) => (
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

export function ProfileList({ profiles, limit }: { profiles: TenantBackofficeProfile[]; limit?: number }) {
  const visible = typeof limit === "number" ? profiles.slice(0, limit) : profiles;
  if (visible.length === 0) {
    return <div className={styles.empty}>No tenant backoffice profiles yet.</div>;
  }

  return (
    <div className={styles.profileList}>
      {visible.map((profile) => (
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

export function TenantList({
  tenants,
  profiles,
  limit
}: {
  tenants: TenantOption[];
  profiles?: TenantBackofficeProfile[];
  limit?: number;
}) {
  const visible = typeof limit === "number" ? tenants.slice(0, limit) : tenants;
  const profilesByTenant = new Map((profiles ?? []).map((profile) => [profile.tenantId, profile]));
  if (visible.length === 0) {
    return <div className={styles.empty}>No tenants are provisioned yet.</div>;
  }

  return (
    <div className={styles.tableList}>
      {visible.map((tenant) => {
        const profile = profilesByTenant.get(tenant.id);
        return (
          <article className={styles.tableRow} key={tenant.id}>
            <div>
              <h3 className={styles.itemTitle}>{tenant.displayName}</h3>
              <p className={styles.itemMeta}>
                {tenant.slug} · {tenant.plan ?? "plan unset"}
                {profile ? ` · ${profile.implementationStage.replaceAll("_", " ")}` : ""}
              </p>
            </div>
            <span className={badgeClass(statusTone(tenant.status))}>{tenant.status}</span>
          </article>
        );
      })}
    </div>
  );
}

export function FinancePanel({ overview, detailed = false }: { overview: Overview; detailed?: boolean }) {
  const modules = detailed ? overview.finance.modules : overview.finance.modules.slice(0, 8);
  return (
    <div className={styles.splitRows}>
      <div className={styles.statLine}>
        <span>Customer bill estimate</span>
        <strong>{formatMoneyCent(overview.finance.totals.estimatedRevenueCent)}</strong>
      </div>
      <div className={styles.statLine}>
        <span>Runtime and provider costs</span>
        <strong>{formatMoneyCent(overview.finance.totals.costCent)}</strong>
      </div>
      <div className={styles.statLine}>
        <span>Gross profit / loss</span>
        <strong>{formatMoneyCent(overview.finance.totals.estimatedMarginCent)}</strong>
      </div>
      <div className={styles.statLine}>
        <span>Gross margin</span>
        <strong>{formatNumber(overview.finance.totals.estimatedMarginPct)}%</strong>
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

export function FinanceModuleTable({ overview }: { overview: Overview }) {
  if (overview.finance.modules.length === 0) {
    return <div className={styles.empty}>No module-level billing or cost events in the selected window.</div>;
  }

  return (
    <div className={styles.financeTable}>
      <div className={`${styles.financeRow} ${styles.financeHeader}`}>
        <span>Module</span>
        <span>Events</span>
        <span>Customer bill</span>
        <span>Runtime cost</span>
        <span>P/L</span>
        <span>Margin</span>
      </div>
      {overview.finance.modules.map((module) => (
        <div className={styles.financeRow} key={module.moduleKey}>
          <span>{module.moduleKey}</span>
          <span>{formatNumber(module.events)}</span>
          <span>{formatMoneyCent(module.estimatedRevenueCent)}</span>
          <span>{formatMoneyCent(module.costCent)}</span>
          <strong>{formatMoneyCent(module.estimatedMarginCent)}</strong>
          <span>{formatNumber(module.estimatedMarginPct)}%</span>
        </div>
      ))}
    </div>
  );
}

export function SecurityPanel({ overview }: { overview: Overview }) {
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

export function OpsPanel({ overview }: { overview: Overview }) {
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

export function AuditPanel({ auditLogs, limit }: { auditLogs: BackofficeAuditPreview[]; limit?: number }) {
  const visible = typeof limit === "number" ? auditLogs.slice(0, limit) : auditLogs;
  if (visible.length === 0) {
    return <div className={styles.empty}>No audit activity has been recorded yet.</div>;
  }
  return (
    <div className={styles.tableList}>
      {visible.map((log) => (
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

export function ModuleGrid({ overview }: { overview: Overview }) {
  const failedOutbox = overview.security.operations.failedOutbox.total;
  const modules = [
    {
      icon: Building2,
      title: "Tenant lifecycle",
      detail: `${formatNumber(overview.tenants.active)} active · ${formatNumber(overview.tenants.suspended)} suspended`,
      href: "/tenants"
    },
    {
      icon: Banknote,
      title: "Billing and P/L",
      detail: `${formatMoneyCent(overview.finance.totals.estimatedRevenueCent)} customer bill estimate`,
      href: "/billing"
    },
    {
      icon: Shield,
      title: "Security and access",
      detail: `${formatNumber(overview.security.operations.activePrivilegedAccessGrants)} active grants`,
      href: "/security"
    },
    {
      icon: Activity,
      title: "Ops and incidents",
      detail: failedOutbox === 0 ? "No failed outbox events" : `${formatNumber(failedOutbox)} failed outbox events`,
      href: "/ops"
    },
    {
      icon: Workflow,
      title: "BizOps workflows",
      detail: "Onboarding, renewals, legal, deliverability, and partner work",
      href: "/workflows"
    },
    {
      icon: FileLock2,
      title: "Evidence",
      detail: "Security packs, contracts, DPAs, provider links, and R2 artifacts",
      href: "/audit"
    },
    {
      icon: Gauge,
      title: "Usage posture",
      detail: `${formatNumber(overview.finance.totals.events)} billable events in the current window`,
      href: "/billing"
    },
    {
      icon: LifeBuoy,
      title: "Support control",
      detail: "Privileged access, impersonation review, and escalation state",
      href: "/security"
    }
  ];

  return (
    <div className={styles.moduleGrid}>
      {modules.map((module) => {
        const Icon = module.icon;
        return (
          <a className={styles.module} href={module.href} key={module.title}>
            <div className={styles.iconBox}>
              <Icon size={18} aria-hidden="true" />
            </div>
            <h3 className={styles.moduleTitle}>{module.title}</h3>
            <p className={styles.moduleDetail}>{module.detail}</p>
          </a>
        );
      })}
    </div>
  );
}

export function OperatingRhythm() {
  const items = [
    { icon: ClipboardList, label: "Onboard", detail: "Provision tenant, set plan, open implementation case." },
    { icon: Shield, label: "Secure", detail: "Confirm owner, access policy, modules, and evidence links." },
    { icon: Banknote, label: "Bill", detail: "Sync subscription, draft invoices, handle credits and dunning." },
    { icon: FileClock, label: "Review", detail: "Audit sensitive actions and lifecycle changes before closeout." }
  ];

  return (
    <div className={styles.rhythmGrid}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className={styles.rhythmItem} key={item.label}>
            <Icon size={18} aria-hidden="true" />
            <div>
              <h3 className={styles.itemTitle}>{item.label}</h3>
              <p className={styles.itemMeta}>{item.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
