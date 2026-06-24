"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { TenantOption } from "./_components/work-ui";
import styles from "./page.module.css";

type Feedback = {
  tone: "success" | "error";
  message: string;
} | null;

async function readError(response: Response) {
  try {
    const body = await response.json();
    return typeof body?.error === "string" ? body.error : response.statusText;
  } catch {
    return response.statusText;
  }
}

function dateTimeLocalToIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function createIdempotencyKey(action: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${action}:${Date.now()}:${random}`;
}

export default function BillingActions({
  tenants,
  selectedTenantId
}: {
  tenants: TenantOption[];
  selectedTenantId?: string;
}) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState(selectedTenantId ?? tenants[0]?.id ?? "");
  const [adjustmentType, setAdjustmentType] = useState("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [eventType, setEventType] = useState("reminder_sent");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (selectedTenantId) setTenantId(selectedTenantId);
  }, [selectedTenantId]);

  async function postBillingAction(action: Record<string, unknown>, busy: string, success: string) {
    if (!tenantId) return;
    setBusyKey(busy);
    setFeedback(null);
    try {
      const response = await fetch(`/api/backoffice/billing/${tenantId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...action,
          idempotencyKey: createIdempotencyKey(String(action.action ?? busy))
        })
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json().catch(() => null);
      setFeedback({
        tone: "success",
        message: body?.deduplicated ? `${success} Existing result reused.` : success
      });
      router.refresh();
      return true;
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not update billing state."
      });
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function syncSubscription() {
    const tenant = tenants.find((item) => item.id === tenantId);
    if (!window.confirm(`Sync subscription state for ${tenant?.displayName ?? "this tenant"} from enabled modules?`)) {
      return;
    }
    await postBillingAction(
      { action: "sync_subscription" },
      "sync",
      "Subscription synced from tenant modules."
    );
  }

  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = dateTimeLocalToIso(periodStart);
    const end = dateTimeLocalToIso(periodEnd);
    if (start && end && new Date(end) <= new Date(start)) {
      setFeedback({ tone: "error", message: "Invoice period end must be after period start." });
      return;
    }
    if (!window.confirm("Create a draft invoice from persisted subscription, usage, and adjustment data?")) {
      return;
    }
    await postBillingAction(
      {
        action: "create_invoice_draft",
        periodStart: start,
        periodEnd: end
      },
      "invoice",
      "Invoice draft created."
    );
  }

  async function createAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) return;
    if (!reason.trim()) {
      setFeedback({ tone: "error", message: "A reason is required for billing adjustments." });
      return;
    }
    if (!window.confirm(`Record a ${adjustmentType.replaceAll("_", " ")} adjustment for ${amount} ZAR?`)) {
      return;
    }
    const ok = await postBillingAction(
      {
        action: "create_adjustment",
        adjustmentType,
        amountCent: Math.round(numeric * 100),
        reason: reason.trim()
      },
      "adjustment",
      "Billing adjustment recorded."
    );
    if (ok) {
      setAmount("");
      setReason("");
    }
  }

  async function recordCollectionEvent() {
    if (!window.confirm(`Record ${eventType.replaceAll("_", " ")} for this tenant?`)) {
      return;
    }
    await postBillingAction(
      {
        action: "record_collection_event",
        eventType,
        status: "sent"
      },
      "collection",
      "Collection event recorded."
    );
  }

  return (
    <section className={styles.actionDeck}>
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Billing tenant</h2>
            <p className={styles.panelSub}>Select the tenant for subscription, invoice, credit, refund, and dunning actions.</p>
          </div>
          <span className={styles.badge}>MFA required</span>
        </div>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span>Tenant</span>
          <select value={tenantId} onChange={(event) => setTenantId(event.target.value)} required>
            {tenants.map((tenant) => (
              <option value={tenant.id} key={tenant.id}>
                {tenant.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.buttonRow}>
          <button className={styles.primaryButton} type="button" onClick={syncSubscription} disabled={busyKey === "sync" || tenants.length === 0}>
            {busyKey === "sync" ? "Syncing..." : "Sync subscription"}
          </button>
          <button className={styles.secondaryButton} type="button" onClick={recordCollectionEvent} disabled={busyKey === "collection" || tenants.length === 0}>
            {busyKey === "collection" ? "Recording..." : "Record collection event"}
          </button>
        </div>
        <label className={styles.field}>
          <span>Collection event</span>
          <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
            <option value="reminder_sent">Reminder sent</option>
            <option value="payment_attempted">Payment attempted</option>
            <option value="payment_failed">Payment failed</option>
            <option value="dunning_started">Dunning started</option>
            <option value="collections_paused">Collections paused</option>
          </select>
        </label>
      </div>

      <form className={styles.panel} onSubmit={createInvoice}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Create invoice draft</h2>
            <p className={styles.panelSub}>Persist an explainable invoice lifecycle draft from subscription items, usage, adjustments, and tax.</p>
          </div>
          <span className={styles.badge}>Draft</span>
        </div>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Period start</span>
            <input type="datetime-local" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Period end</span>
            <input type="datetime-local" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </label>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={busyKey === "invoice" || tenants.length === 0}>
          {busyKey === "invoice" ? "Creating..." : "Create invoice draft"}
        </button>
      </form>

      <form className={styles.panel} onSubmit={createAdjustment}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Credit, refund, write-off, or proration</h2>
            <p className={styles.panelSub}>Record signed commercial adjustments so customer billing and internal margin stay explainable.</p>
          </div>
          <span className={styles.badge}>Audited</span>
        </div>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Type</span>
            <select value={adjustmentType} onChange={(event) => setAdjustmentType(event.target.value)}>
              <option value="credit">Credit</option>
              <option value="refund">Refund</option>
              <option value="write_off">Write-off</option>
              <option value="proration">Proration</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Amount ZAR</span>
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Reason</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} required />
          </label>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={busyKey === "adjustment" || tenants.length === 0}>
          {busyKey === "adjustment" ? "Recording..." : "Record adjustment"}
        </button>
      </form>

      {feedback ? (
        <div className={feedback.tone === "success" ? styles.feedbackSuccess : styles.feedbackError}>
          {feedback.message}
        </div>
      ) : null}
    </section>
  );
}
