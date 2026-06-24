import BillingActions from "../BillingActions";
import {
  BackofficeFrame,
  Metric,
  Panel,
  badgeClass,
  formatMoneyCent,
  formatNumber,
  getBackofficePageData,
  shortDate
} from "../_components/work-ui";
import {
  getBackofficeBillingDashboard,
  type BillingRiskFlag,
  type ModuleProfitabilityRow,
  type TenantFinancialHealthRow
} from "@/server/backoffice/billing-dashboard";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

type BillingSearchParams = {
  tenantId?: string;
  windowDays?: string;
};

function flagTone(flags: BillingRiskFlag[]) {
  if (flags.some((flag) => flag.tone === "danger")) return "danger";
  if (flags.some((flag) => flag.tone === "warn")) return "warn";
  if (flags.some((flag) => flag.tone === "good")) return "good";
  return "neutral";
}

function healthLabel(row: TenantFinancialHealthRow) {
  const danger = row.flags.filter((flag) => flag.tone === "danger").length;
  const warn = row.flags.filter((flag) => flag.tone === "warn").length;
  if (danger > 0) return `${danger} critical`;
  if (warn > 0) return `${warn} warning`;
  return "Clear";
}

function FlagList({ flags, limit }: { flags: BillingRiskFlag[]; limit?: number }) {
  const visible = typeof limit === "number" ? flags.slice(0, limit) : flags;
  if (visible.length === 0) {
    return <span className={badgeClass("good")}>No flags</span>;
  }
  return (
    <div className={styles.flagList}>
      {visible.map((flag) => (
        <span className={badgeClass(flag.tone)} title={flag.detail} key={flag.key}>
          {flag.label}
        </span>
      ))}
    </div>
  );
}

function TenantHealthTable({
  rows,
  selectedTenantId
}: {
  rows: TenantFinancialHealthRow[];
  selectedTenantId: string | null;
}) {
  if (rows.length === 0) {
    return <div className={styles.empty}>No tenants are provisioned yet.</div>;
  }

  return (
    <div className={styles.billingTable}>
      <div className={`${styles.billingRow} ${styles.billingHeader}`}>
        <span>Tenant</span>
        <span>P/L</span>
        <span>Open AR</span>
        <span>Overdue</span>
        <span>Collections</span>
        <span>Evidence</span>
      </div>
      {rows.map((row) => (
        <a
          className={`${styles.billingRow} ${selectedTenantId === row.tenantId ? styles.billingRowActive : ""}`}
          href={`/billing?tenantId=${row.tenantId}`}
          key={row.tenantId}
        >
          <span>
            <strong>{row.displayName}</strong>
            <small>{row.slug} · {row.plan} · {row.status}</small>
          </span>
          <span>
            <strong>{formatMoneyCent(row.estimatedMarginCent)}</strong>
            <small>{formatNumber(row.estimatedMarginPct)}% margin</small>
          </span>
          <span>{formatMoneyCent(row.openReceivablesCent)}</span>
          <span>{formatMoneyCent(row.overdueReceivablesCent)}</span>
          <span>
            <strong>{row.collectionStatus}</strong>
            <small>{row.dunningStatus}</small>
          </span>
          <span>
            <span className={badgeClass(flagTone(row.flags))}>{healthLabel(row)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

function ModuleProfitabilityTable({ rows }: { rows: ModuleProfitabilityRow[] }) {
  if (rows.length === 0) {
    return <div className={styles.empty}>No module-level usage or runtime cost in the selected window.</div>;
  }

  return (
    <div className={styles.moduleProfitTable}>
      <div className={`${styles.moduleProfitRow} ${styles.billingHeader}`}>
        <span>Module / usage</span>
        <span>Provider</span>
        <span>Events</span>
        <span>Customer bill</span>
        <span>Runtime cost</span>
        <span>P/L</span>
        <span>Margin</span>
      </div>
      {rows.map((row) => (
        <div className={styles.moduleProfitRow} key={`${row.tenantId ?? "global"}:${row.moduleKey}:${row.usageKind}:${row.providerMode ?? "none"}`}>
          <span>
            <strong>{row.moduleKey}</strong>
            <small>{row.usageKind}</small>
          </span>
          <span>{row.providerMode ?? "none"}</span>
          <span>{formatNumber(row.events)}</span>
          <span>{formatMoneyCent(row.estimatedRevenueCent)}</span>
          <span>{formatMoneyCent(row.costCent)}</span>
          <strong>{formatMoneyCent(row.estimatedMarginCent)}</strong>
          <span>{formatNumber(row.estimatedMarginPct)}%</span>
        </div>
      ))}
    </div>
  );
}

export default async function BillingPage({
  searchParams
}: {
  searchParams?: Promise<BillingSearchParams>;
}) {
  const result = await getBackofficePageData();
  if (!result.ok) return result.node;

  const params = await searchParams;
  const { user, tenants } = result.data;
  const dashboard = await getBackofficeBillingDashboard({
    selectedTenantId: params?.tenantId,
    windowDays: Number(params?.windowDays ?? 30)
  });
  const marginTone = dashboard.summary.estimatedMarginCent >= 0 ? "good" : "danger";
  const selected = dashboard.selectedTenant;

  return (
    <BackofficeFrame
      user={user}
      active="/billing"
      eyebrow="Billing and finance"
      title="Run revenue, cost, collections, and billing evidence."
      subtitle="Internal finance cockpit for tenant profitability, lifecycle invoices, adjustments, dunning, reconciliation flags, and audit evidence. Money is derived server-side from billing lifecycle and usage records."
      badge={<span className={badgeClass(marginTone)}>{formatNumber(dashboard.summary.estimatedMarginPct)}% gross margin</span>}
    >
      <div className={styles.grid}>
        <section className={styles.metrics}>
          <Metric label="Customer bill estimate" value={formatMoneyCent(dashboard.summary.estimatedRevenueCent)} detail={`${formatNumber(dashboard.windowDays)} day usage window`} />
          <Metric label="Runtime/provider costs" value={formatMoneyCent(dashboard.summary.costCent)} detail="Direct metered provider/runtime cost" />
          <Metric label="Gross profit / loss" value={formatMoneyCent(dashboard.summary.estimatedMarginCent)} detail={`${formatNumber(dashboard.summary.estimatedMarginPct)}% estimated gross margin`} />
          <Metric label="Open / overdue AR" value={formatMoneyCent(dashboard.summary.openReceivablesCent)} detail={`${formatMoneyCent(dashboard.summary.overdueReceivablesCent)} overdue`} />
        </section>

        <section className={styles.twoCol}>
          <Panel
            title="Revenue assurance"
            subtitle="Business-level finance posture across tenants from server-side billing data."
            badge={<span className={badgeClass(dashboard.summary.flaggedTenantCount > 0 ? "warn" : "good")}>{formatNumber(dashboard.summary.flaggedTenantCount)} flagged</span>}
          >
            <div className={styles.splitRows}>
              <div className={styles.statLine}>
                <span>Tenants monitored</span>
                <strong>{formatNumber(dashboard.summary.tenantCount)}</strong>
              </div>
              <div className={styles.statLine}>
                <span>Pending adjustments</span>
                <strong>{formatMoneyCent(dashboard.summary.pendingAdjustmentCent)}</strong>
              </div>
              <div className={styles.statLine}>
                <span>Collections events</span>
                <strong>{formatNumber(dashboard.summary.collectionEventCount)}</strong>
              </div>
              <div className={styles.statLine}>
                <span>Workspace key</span>
                <strong>{dashboard.workspaceKey}</strong>
              </div>
            </div>
          </Panel>
          <Panel
            title="Reconciliation flags"
            subtitle="The UI must expose uncertainty instead of hiding missing provider evidence."
            badge={<span className={styles.badge}>Evidence posture</span>}
          >
            <div className={styles.checkList}>
              {dashboard.reconciliationFlags.map((flag) => (
                <div className={styles.checkItem} key={flag.key}>
                  <span className={badgeClass(flag.tone)}>{flag.label}</span>
                  <div>
                    <h3 className={styles.itemTitle}>{flag.label}</h3>
                    <p className={styles.itemMeta}>{flag.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        <Panel
          title="Tenant financial health"
          subtitle="Profitability, receivables, collections posture, and missing-evidence flags by tenant."
          badge={<span className={styles.badge}>Click tenant to inspect</span>}
        >
          <TenantHealthTable rows={dashboard.tenantRows} selectedTenantId={dashboard.selectedTenantId} />
        </Panel>

        {selected ? (
          <section className={styles.twoCol}>
            <Panel
              title={`${selected.tenant.displayName} drill-down`}
              subtitle="Subscription source, current estimate, invoice lifecycle, pending adjustments, and risk flags."
              badge={<span className={badgeClass(flagTone(selected.tenant.flags))}>{healthLabel(selected.tenant)}</span>}
            >
              <div className={styles.splitRows}>
                <div className={styles.statLine}>
                  <span>Billing email</span>
                  <strong>{selected.lifecycle.account.billingEmail ?? "Missing"}</strong>
                </div>
                <div className={styles.statLine}>
                  <span>Subscription source</span>
                  <strong>{selected.lifecycle.subscription.source.replaceAll("_", " ")}</strong>
                </div>
                <div className={styles.statLine}>
                  <span>Estimated invoice</span>
                  <strong>{formatMoneyCent(selected.lifecycle.estimatedInvoice.totalCent)}</strong>
                </div>
                <div className={styles.statLine}>
                  <span>Pending adjustments</span>
                  <strong>{formatNumber(selected.lifecycle.pendingAdjustments.length)}</strong>
                </div>
              </div>
              <div className={styles.flagBlock}>
                <FlagList flags={selected.tenant.flags} />
              </div>
            </Panel>
            <Panel
              title="Invoice lifecycle"
              subtitle="Persisted invoices and line evidence, tenant-scoped from lifecycle tables."
              badge={<span className={styles.badge}>{formatNumber(selected.lifecycle.invoices.length)} invoices</span>}
            >
              <div className={styles.tableList}>
                {selected.lifecycle.invoices.length === 0 ? (
                  <div className={styles.empty}>No persisted invoices for this tenant yet.</div>
                ) : selected.lifecycle.invoices.map((invoice) => (
                  <article className={styles.tableRow} key={invoice.id}>
                    <div>
                      <h3 className={styles.itemTitle}>{invoice.invoiceNumber}</h3>
                      <p className={styles.itemMeta}>
                        {invoice.status} · due {shortDate(invoice.dueAt)} · {invoice.id}
                      </p>
                    </div>
                    <strong>{formatMoneyCent(invoice.amountDueCent)}</strong>
                  </article>
                ))}
              </div>
            </Panel>
          </section>
        ) : null}

        {selected ? (
          <Panel
            title="Billing adjustments"
            subtitle="Pending, applied, voided, credit, refund, write-off, and proration evidence for the selected tenant."
            badge={<span className={styles.badge}>{formatNumber(selected.adjustments.length)} adjustments</span>}
          >
            <div className={styles.tableList}>
              {selected.adjustments.length === 0 ? (
                <div className={styles.empty}>No billing adjustments have been recorded for this tenant.</div>
              ) : selected.adjustments.map((adjustment) => (
                <article className={styles.tableRow} key={adjustment.id}>
                  <div>
                    <h3 className={styles.itemTitle}>{adjustment.type.replaceAll("_", " ")}</h3>
                    <p className={styles.itemMeta}>
                      {adjustment.reason} · {shortDate(adjustment.createdAt)}
                      {adjustment.appliedAt ? ` · applied ${shortDate(adjustment.appliedAt)}` : ""}
                    </p>
                  </div>
                  <div className={styles.valueStack}>
                    <strong>{formatMoneyCent(adjustment.amountCent)}</strong>
                    <span className={styles.badge}>{adjustment.status}</span>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        ) : null}

        <Panel
          title="Module profitability"
          subtitle="Usage-kind profitability with provider mode, event count, customer bill estimate, direct cost, and P/L."
          badge={<span className={styles.badge}>Server calculated</span>}
        >
          <ModuleProfitabilityTable rows={dashboard.moduleProfitability} />
        </Panel>

        {selected ? (
          <section className={styles.twoCol}>
            <Panel
              title="Collections and dunning"
              subtitle="Recent collection events and dunning posture for the selected tenant."
              badge={<span className={styles.badge}>{selected.tenant.collectionStatus}</span>}
            >
              <div className={styles.tableList}>
                {selected.collectionEvents.length === 0 ? (
                  <div className={styles.empty}>No collection events recorded for this tenant.</div>
                ) : selected.collectionEvents.map((event) => (
                  <article className={styles.tableRow} key={event.id}>
                    <div>
                      <h3 className={styles.itemTitle}>{event.eventType.replaceAll("_", " ")}</h3>
                      <p className={styles.itemMeta}>
                        attempt {formatNumber(event.attemptNumber)} · {shortDate(event.createdAt)}
                      </p>
                    </div>
                    <span className={styles.badge}>{event.status}</span>
                  </article>
                ))}
              </div>
            </Panel>
            <Panel
              title="Audit evidence"
              subtitle="Recent tenant-scoped billing and operational audit events."
              badge={<span className={styles.badge}>{formatNumber(selected.auditLogs.length)} events</span>}
            >
              <div className={styles.tableList}>
                {selected.auditLogs.length === 0 ? (
                  <div className={styles.empty}>No audit events recorded for this tenant.</div>
                ) : selected.auditLogs.map((log) => (
                  <article className={styles.tableRow} key={log.id}>
                    <div>
                      <h3 className={styles.itemTitle}>{log.action}</h3>
                      <p className={styles.itemMeta}>
                        {log.entityType}{log.actorEmail ? ` · ${log.actorEmail}` : ""} · {shortDate(log.createdAt)}
                      </p>
                    </div>
                    <span className={styles.badge}>{log.entityId ? "linked" : "event"}</span>
                  </article>
                ))}
              </div>
            </Panel>
          </section>
        ) : null}

        {selected ? (
          <Panel
            title="Invoice line evidence"
            subtitle="Latest persisted invoice lines for reconciliation against totals and usage events."
            badge={<span className={styles.badge}>{formatNumber(selected.invoiceLines.length)} lines</span>}
          >
            <div className={styles.invoiceLineGrid}>
              {selected.invoiceLines.length === 0 ? (
                <div className={styles.empty}>No invoice lines have been persisted for this tenant yet.</div>
              ) : selected.invoiceLines.map((line) => (
                <article className={styles.requirementItem} key={line.id}>
                  <h3 className={styles.itemTitle}>{line.description}</h3>
                  <p className={styles.itemMeta}>
                    {line.lineType} · {line.moduleKey ?? "account"} · {line.usageKind ?? "fixed"} · {formatNumber(line.quantity)}
                  </p>
                  <strong>{formatMoneyCent(line.amountCent)}</strong>
                </article>
              ))}
            </div>
          </Panel>
        ) : null}

        <BillingActions tenants={tenants} selectedTenantId={dashboard.selectedTenantId ?? undefined} />
      </div>
    </BackofficeFrame>
  );
}
