"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  BACKOFFICE_CASE_PRIORITIES,
  BACKOFFICE_CASE_TYPES,
  TENANT_IMPLEMENTATION_STAGES,
  TENANT_RISK_TIERS,
  TENANT_SECURITY_STATUSES
} from "@6esk/types/backoffice";
import styles from "./page.module.css";

export type TenantOption = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  plan?: string;
};

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

export default function BackofficeActions({ tenants }: { tenants: TenantOption[] }) {
  const [caseTenantId, setCaseTenantId] = useState(tenants[0]?.id ?? "");
  const [caseType, setCaseType] = useState<(typeof BACKOFFICE_CASE_TYPES)[number]>("implementation");
  const [priority, setPriority] = useState<(typeof BACKOFFICE_CASE_PRIORITIES)[number]>("p2");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [profileTenantId, setProfileTenantId] = useState(tenants[0]?.id ?? "");
  const [implementationStage, setImplementationStage] = useState<(typeof TENANT_IMPLEMENTATION_STAGES)[number]>("discovery");
  const [riskTier, setRiskTier] = useState<(typeof TENANT_RISK_TIERS)[number]>("standard");
  const [securityStatus, setSecurityStatus] = useState<(typeof TENANT_SECURITY_STATUSES)[number]>("pending");
  const [internalNotes, setInternalNotes] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === profileTenantId) ?? null,
    [profileTenantId, tenants]
  );

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!caseTenantId || !title.trim()) return;
    setBusyKey("case");
    setFeedback(null);
    try {
      const response = await fetch("/api/backoffice/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: caseTenantId,
          caseType,
          priority,
          title: title.trim(),
          summary: summary.trim() || null
        })
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setTitle("");
      setSummary("");
      setFeedback({ tone: "success", message: "Workflow case created." });
      window.location.reload();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not create workflow case."
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
          internalNotes: internalNotes.trim() || null
        })
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      setFeedback({ tone: "success", message: "Tenant profile updated." });
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
    <section className={styles.twoCol}>
      <form className={styles.panel} onSubmit={createCase}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Create workflow case</h2>
            <p className={styles.panelSub}>Open tenant-linked BizOps work for implementation, security, legal, incidents, or renewals.</p>
          </div>
          <span className={styles.badge}>Audited</span>
        </div>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Tenant</span>
            <select value={caseTenantId} onChange={(event) => setCaseTenantId(event.target.value)} required>
              {tenants.map((tenant) => (
                <option value={tenant.id} key={tenant.id}>
                  {tenant.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Type</span>
            <select value={caseType} onChange={(event) => setCaseType(event.target.value as typeof caseType)}>
              {BACKOFFICE_CASE_TYPES.map((value) => (
                <option value={value} key={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
              {BACKOFFICE_CASE_PRIORITIES.map((value) => (
                <option value={value} key={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span>Summary</span>
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} maxLength={2000} />
          </label>
        </div>
        <button className={styles.primaryButton} type="submit" disabled={busyKey === "case" || tenants.length === 0}>
          {busyKey === "case" ? "Creating..." : "Create case"}
        </button>
      </form>

      <form className={styles.panel} onSubmit={updateProfile}>
        <div className={styles.panelHeader}>
          <div>
            <h2 className={styles.panelTitle}>Update tenant profile</h2>
            <p className={styles.panelSub}>Maintain implementation, risk, and security posture for internal operators.</p>
          </div>
          <span className={styles.badge}>{selectedTenant?.status ?? "tenant"}</span>
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
            <select
              value={implementationStage}
              onChange={(event) => setImplementationStage(event.target.value as typeof implementationStage)}
            >
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
            <select
              value={securityStatus}
              onChange={(event) => setSecurityStatus(event.target.value as typeof securityStatus)}
            >
              {TENANT_SECURITY_STATUSES.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
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
