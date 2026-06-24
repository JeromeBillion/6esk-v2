"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import {
  BACKOFFICE_CASE_PRIORITIES,
  BACKOFFICE_CASE_TYPES
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

export default function WorkflowActions({ tenants }: { tenants: TenantOption[] }) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [caseType, setCaseType] = useState<(typeof BACKOFFICE_CASE_TYPES)[number]>("implementation");
  const [priority, setPriority] = useState<(typeof BACKOFFICE_CASE_PRIORITIES)[number]>("p2");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || !title.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/backoffice/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId,
          caseType,
          priority,
          title: title.trim(),
          summary: summary.trim() || null
        })
      });
      if (!response.ok) throw new Error(await readError(response));
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
      setBusy(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={createCase}>
      <div className={styles.panelHeader}>
        <div>
          <h2 className={styles.panelTitle}>Create workflow case</h2>
          <p className={styles.panelSub}>Open tenant-linked BizOps work for onboarding, incidents, renewals, legal, security, or deliverability.</p>
        </div>
        <span className={styles.badge}>Audited</span>
      </div>
      <div className={styles.formGrid}>
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
      <button className={styles.primaryButton} type="submit" disabled={busy || tenants.length === 0}>
        {busy ? "Creating..." : "Create case"}
      </button>
      {feedback ? (
        <div className={feedback.tone === "success" ? styles.feedbackSuccess : styles.feedbackError}>
          {feedback.message}
        </div>
      ) : null}
    </form>
  );
}
