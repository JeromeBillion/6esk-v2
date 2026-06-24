"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  TENANT_IMPLEMENTATION_STAGES,
  TENANT_RISK_TIERS,
  TENANT_SECURITY_STATUSES
} from "@6esk/types/backoffice";
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

export default function TenantManagementActions({ tenants }: { tenants: TenantOption[] }) {
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [plan, setPlan] = useState("starter");
  const [lifecycleTenantId, setLifecycleTenantId] = useState(tenants[0]?.id ?? "");
  const [lifecycleAction, setLifecycleAction] = useState("suspend");
  const [lifecyclePlan, setLifecyclePlan] = useState("starter");
  const [reason, setReason] = useState("");
  const [profileTenantId, setProfileTenantId] = useState(tenants[0]?.id ?? "");
  const [implementationStage, setImplementationStage] =
    useState<(typeof TENANT_IMPLEMENTATION_STAGES)[number]>("discovery");
  const [riskTier, setRiskTier] = useState<(typeof TENANT_RISK_TIERS)[number]>("standard");
  const [securityStatus, setSecurityStatus] =
    useState<(typeof TENANT_SECURITY_STATUSES)[number]>("pending");
  const [renewalDate, setRenewalDate] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === lifecycleTenantId) ?? null,
    [lifecycleTenantId, tenants]
  );

  async function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("provision");
    setFeedback(null);
    try {
      const response = await fetch("/api/backoffice/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          displayName: displayName.trim(),
          plan: plan.trim() || undefined
        })
      });
      if (!response.ok) throw new Error(await readError(response));
      setSlug("");
      setDisplayName("");
      setFeedback({ tone: "success", message: "Tenant provisioned with a primary workspace." });
      window.location.reload();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not provision tenant."
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function changeLifecycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lifecycleTenantId) return;
    setBusyKey("lifecycle");
    setFeedback(null);
    const payload =
      lifecycleAction === "change_plan"
        ? {
            action: lifecycleAction,
            plan: lifecyclePlan.trim(),
            reason: reason.trim() || undefined
          }
        : {
            action: lifecycleAction,
            reason: reason.trim() || undefined
          };
    try {
      const response = await fetch(`/api/backoffice/tenants/${lifecycleTenantId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await readError(response));
      setReason("");
      setFeedback({ tone: "success", message: "Tenant lifecycle updated and audited." });
      window.location.reload();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not update tenant lifecycle."
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileTenantId) return;
    setBusyKey("profile");
    setFeedback(null);
    try {
      const response = await fetch(`/api/backoffice/tenants/${profileTenantId}/profile`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          implementationStage,
          riskTier,
          securityStatus,
          renewalDate: renewalDate || null,
          internalNotes: internalNotes.trim() || null
        })
      });
      if (!response.ok) throw new Error(await readError(response));
      setFeedback({ tone: "success", message: "Tenant operating profile updated." });
      window.location.reload();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not update tenant profile."
      });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className={styles.actionDeck}>
      <form className={styles.panel} onSubmit={provision}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Onboard tenant</h2>
            <p className={styles.panelSub}>Create the tenant boundary, primary workspace, and starting entitlements.</p>
          </div>
          <span className={styles.badge}>MFA required</span>
        </div>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Slug</span>
            <input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="acme-support" required />
          </label>
          <label className={styles.field}>
            <span>Plan</span>
            <input value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="starter" />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Display name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Acme Support" required />
          </label>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={busyKey === "provision"}>
          {busyKey === "provision" ? "Provisioning..." : "Provision tenant"}
        </button>
      </form>

      <form className={styles.panel} onSubmit={changeLifecycle}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Lifecycle control</h2>
            <p className={styles.panelSub}>Suspend, reactivate, close, or change commercial plan with audit evidence.</p>
          </div>
          <span className={styles.badge}>{selectedTenant?.status ?? "tenant"}</span>
        </div>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Tenant</span>
            <select value={lifecycleTenantId} onChange={(event) => setLifecycleTenantId(event.target.value)} required>
              {tenants.map((tenant) => (
                <option value={tenant.id} key={tenant.id}>
                  {tenant.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Action</span>
            <select value={lifecycleAction} onChange={(event) => setLifecycleAction(event.target.value)}>
              <option value="suspend">Suspend</option>
              <option value="reactivate">Reactivate</option>
              <option value="change_plan">Change plan</option>
              <option value="close">Close tenant</option>
            </select>
          </label>
          {lifecycleAction === "change_plan" ? (
            <label className={styles.field}>
              <span>New plan</span>
              <input value={lifecyclePlan} onChange={(event) => setLifecyclePlan(event.target.value)} required />
            </label>
          ) : null}
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Reason</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </label>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={busyKey === "lifecycle" || tenants.length === 0}>
          {busyKey === "lifecycle" ? "Saving..." : "Apply lifecycle change"}
        </button>
      </form>

      <form className={styles.panel} onSubmit={updateProfile}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Tenant success profile</h2>
            <p className={styles.panelSub}>Maintain launch stage, renewal, risk tier, and security state for internal teams.</p>
          </div>
          <span className={styles.badge}>Audited</span>
        </div>
        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Tenant</span>
            <select value={profileTenantId} onChange={(event) => setProfileTenantId(event.target.value)} required>
              {tenants.map((tenant) => (
                <option value={tenant.id} key={tenant.id}>
                  {tenant.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Stage</span>
            <select value={implementationStage} onChange={(event) => setImplementationStage(event.target.value as typeof implementationStage)}>
              {TENANT_IMPLEMENTATION_STAGES.map((value) => (
                <option value={value} key={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Risk</span>
            <select value={riskTier} onChange={(event) => setRiskTier(event.target.value as typeof riskTier)}>
              {TENANT_RISK_TIERS.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Security</span>
            <select value={securityStatus} onChange={(event) => setSecurityStatus(event.target.value as typeof securityStatus)}>
              {TENANT_SECURITY_STATUSES.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Renewal date</span>
            <input type="date" value={renewalDate} onChange={(event) => setRenewalDate(event.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Internal notes</span>
            <textarea value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} rows={4} maxLength={4000} />
          </label>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={busyKey === "profile" || tenants.length === 0}>
          {busyKey === "profile" ? "Saving..." : "Save profile"}
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
