"use client";

import { useEffect, useState } from "react";
import AppShell from "@/app/components/AppShell";
import TagsClient from "./TagsClient";
import AgentIntegrationClient from "./AgentIntegrationClient";
import SpamRulesClient from "./SpamRulesClient";
import WhatsAppClient from "./WhatsAppClient";
import ProfileLookupClient from "./ProfileLookupClient";

type Role = {
  id: string;
  name: string;
  description?: string | null;
};

type User = {
  id: string;
  email: string;
  display_name: string;
  role_name?: string | null;
  role_id?: string | null;
  is_active: boolean;
  created_at: string;
};

type SlaConfig = {
  firstResponseMinutes: number;
  resolutionMinutes: number;
};

type AuditLog = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
  actor_name?: string | null;
  actor_email?: string | null;
};

type SpamMessage = {
  id: string;
  subject: string | null;
  from_email: string;
  received_at: string | null;
  spam_reason: string | null;
  mailbox_address: string;
};

type InboundFailure = {
  id: string;
  idempotency_key: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
};

type InboundMetricsPoint = {
  hour: string;
  failed: number;
  processed: number;
  processing: number;
  attempts: number;
};

type InboundMetrics = {
  generatedAt: string;
  windowHours: number;
  summary: {
    failedQueue: number;
    dueRetryNow: number;
    processingNow: number;
    processedWindow: number;
    failedWindow: number;
    attemptsWindow: number;
    retryProcessedWindow: number;
    retryFailedWindow: number;
    highAttemptQueue: number;
    maxFailedAttemptCount: number;
    p95FailedAttemptCount: number;
    oldestFailedAgeMinutes: number | null;
  };
  alert: {
    source: "db" | "env";
    webhookConfigured: boolean;
    threshold: number;
    windowMinutes: number;
    cooldownMinutes: number;
    currentFailures: number;
    status: "below_threshold" | "cooldown" | "at_or_above_threshold";
    cooldownRemainingMinutes: number;
    lastSentAt: string | null;
    wouldSendNow: boolean;
    recommendation: {
      suggestedMinThreshold: number;
      suggestedMaxThreshold: number;
      inRange: boolean;
      reason: "insufficient_history" | "aligned" | "outside_range";
      avgBucketFailures: number;
      p95BucketFailures: number;
      maxBucketFailures: number;
      bucketCount: number;
    };
  };
  series: InboundMetricsPoint[];
};

type InboundAlertConfig = {
  source: "db" | "env";
  webhookUrl: string;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
  updatedAt: string | null;
};

type SecurityStatus = {
  adminAllowlist: string[];
  agentAllowlist: string[];
  agentSecretKeyConfigured: boolean;
  inboundSecretConfigured: boolean;
  clientIp?: string | null;
  agentIntegrationStats: {
    total: number;
    encrypted: number;
    unencrypted: number;
  };
  whatsappTokenStats: {
    total: number;
    encrypted: number;
    unencrypted: number;
    missing: number;
  };
};

const ADMIN_SECTIONS = [
  { key: "users", label: "Users" },
  { key: "create-user", label: "Create User" },
  { key: "sla", label: "SLA Targets" },
  { key: "tags", label: "Tags" },
  { key: "spam-rules", label: "Spam Rules" },
  { key: "agent", label: "AI Agent" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "profile-lookup", label: "Profile Lookup" },
  { key: "security", label: "Security" },
  { key: "inbound", label: "Inbound Failures" },
  { key: "spam-review", label: "Spam Review" },
  { key: "audit-log", label: "Audit Log" }
];

export default function AdminClient() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [activeSection, setActiveSection] = useState<string>("users");
  const [userQuery, setUserQuery] = useState("");
  const [sla, setSla] = useState<SlaConfig>({
    firstResponseMinutes: 120,
    resolutionMinutes: 1440
  });
  const [slaStatus, setSlaStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [form, setForm] = useState({
    email: "",
    displayName: "",
    password: "",
    roleId: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [resetLinks, setResetLinks] = useState<Record<string, string>>({});
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [spamMessages, setSpamMessages] = useState<SpamMessage[]>([]);
  const [inboundFailures, setInboundFailures] = useState<InboundFailure[]>([]);
  const [inboundMetrics, setInboundMetrics] = useState<InboundMetrics | null>(null);
  const [inboundMetricsError, setInboundMetricsError] = useState<string | null>(null);
  const [inboundAlertConfig, setInboundAlertConfig] = useState<InboundAlertConfig | null>(null);
  const [inboundAlertForm, setInboundAlertForm] = useState({
    webhookUrl: "",
    threshold: 5,
    windowMinutes: 30,
    cooldownMinutes: 60
  });
  const [savingInboundAlertConfig, setSavingInboundAlertConfig] = useState(false);
  const [inboundAlertConfigError, setInboundAlertConfigError] = useState<string | null>(null);
  const [retryingInbound, setRetryingInbound] = useState(false);
  const [checkingAlerts, setCheckingAlerts] = useState(false);
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);

  async function loadData() {
    const [
      rolesRes,
      usersRes,
      slaRes,
      logsRes,
      spamRes,
      inboundRes,
      securityRes,
      inboundMetricsRes,
      inboundSettingsRes
    ] =
      await Promise.all([
        fetch("/api/admin/roles"),
        fetch("/api/admin/users"),
        fetch("/api/admin/sla"),
        fetch("/api/admin/audit-logs?limit=50"),
        fetch("/api/admin/spam-messages?limit=50"),
        fetch("/api/admin/inbound/failed?limit=50"),
        fetch("/api/admin/security"),
        fetch("/api/admin/inbound/metrics?hours=24"),
        fetch("/api/admin/inbound/settings")
      ]);

    if (rolesRes.ok) {
      const payload = await rolesRes.json();
      setRoles(payload.roles ?? []);
      if (!form.roleId && payload.roles?.[0]) {
        setForm((prev) => ({ ...prev, roleId: payload.roles[0].id }));
      }
    }

    if (usersRes.ok) {
      const payload = await usersRes.json();
      setUsers(payload.users ?? []);
    }

    if (slaRes.ok) {
      const payload = await slaRes.json();
      setSla({
        firstResponseMinutes: payload.firstResponseMinutes ?? 120,
        resolutionMinutes: payload.resolutionMinutes ?? 1440
      });
    }

    if (logsRes.ok) {
      const payload = await logsRes.json();
      setAuditLogs(payload.logs ?? []);
    }

    if (spamRes.ok) {
      const payload = await spamRes.json();
      setSpamMessages(payload.messages ?? []);
    }

    if (inboundRes.ok) {
      const payload = await inboundRes.json();
      setInboundFailures(payload.events ?? []);
    }

    if (securityRes.ok) {
      const payload = await securityRes.json();
      setSecurity(payload);
      setSecurityError(null);
    } else {
      setSecurityError("Failed to load security status.");
    }

    if (inboundMetricsRes.ok) {
      const payload = await inboundMetricsRes.json();
      setInboundMetrics(payload);
      setInboundMetricsError(null);
    } else {
      setInboundMetrics(null);
      setInboundMetricsError("Failed to load inbound trend metrics.");
    }

    if (inboundSettingsRes.ok) {
      const payload = await inboundSettingsRes.json();
      const config = payload.config as InboundAlertConfig | undefined;
      if (config) {
        setInboundAlertConfig(config);
        setInboundAlertForm({
          webhookUrl: config.webhookUrl ?? "",
          threshold: config.threshold ?? 5,
          windowMinutes: config.windowMinutes ?? 30,
          cooldownMinutes: config.cooldownMinutes ?? 60
        });
        setInboundAlertConfigError(null);
      }
    } else {
      setInboundAlertConfig(null);
      setInboundAlertConfigError("Failed to load inbound alert settings.");
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Failed to create user");
      setLoading(false);
      return;
    }

    setForm((prev) => ({ ...prev, email: "", displayName: "", password: "" }));
    await loadData();
    setLoading(false);
  }

  async function updateUser(userId: string, updates: { roleId?: string; isActive?: boolean }) {
    setUpdatingUserId(userId);
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    });
    await loadData();
    setUpdatingUserId(null);
  }

  async function resetPassword(userId: string) {
    setResettingUserId(userId);
    const res = await fetch(`/api/admin/users/${userId}/password-reset`, { method: "POST" });
    if (res.ok) {
      const payload = await res.json();
      setResetLinks((prev) => ({ ...prev, [userId]: payload.resetLink }));
    }
    setResettingUserId(null);
  }

  async function retryInbound() {
    setRetryingInbound(true);
    await fetch("/api/admin/inbound/retry?limit=25", { method: "POST" });
    await loadData();
    setRetryingInbound(false);
  }

  async function checkInboundAlerts() {
    setCheckingAlerts(true);
    await fetch("/api/admin/inbound/alerts", { method: "POST" });
    await loadData();
    setCheckingAlerts(false);
  }

  async function saveInboundAlertSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingInboundAlertConfig(true);
    setInboundAlertConfigError(null);

    const res = await fetch("/api/admin/inbound/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inboundAlertForm)
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setInboundAlertConfigError(payload.error ?? "Failed to save inbound alert settings.");
      setSavingInboundAlertConfig(false);
      return;
    }

    await loadData();
    setSavingInboundAlertConfig(false);
  }

  async function unspamMessage(messageId: string) {
    await fetch(`/api/messages/${messageId}/spam`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSpam: false, reason: null })
    });
    await loadData();
  }

  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
  const normalizedUserQuery = userQuery.trim().toLowerCase();
  const filteredUsers = normalizedUserQuery
    ? users.filter((user) =>
        `${user.display_name} ${user.email}`.toLowerCase().includes(normalizedUserQuery)
      )
    : users;

  const adminAllowlist = security?.adminAllowlist ?? [];
  const agentAllowlist = security?.agentAllowlist ?? [];
  const encryptionEnabled = security?.agentSecretKeyConfigured ?? false;
  const inboundSecretEnabled = security?.inboundSecretConfigured ?? false;
  const allowlistSnippet = [
    `ADMIN_IP_ALLOWLIST=${adminAllowlist.length ? adminAllowlist.join(",") : "1.2.3.4,5.6.7.8"}`,
    `AGENT_IP_ALLOWLIST=${agentAllowlist.length ? agentAllowlist.join(",") : "1.2.3.4,5.6.7.8"}`
  ].join("\n");

  function getSectionCount(key: string) {
    switch (key) {
      case "users":
        return users.length;
      case "spam-review":
        return spamMessages.length;
      case "inbound":
        return inboundFailures.length;
      case "audit-log":
        return auditLogs.length;
      default:
        return null;
    }
  }

  const inboundSeries = inboundMetrics?.series ?? [];
  const inboundWindowHours = inboundMetrics?.windowHours ?? 24;
  const inboundAlert = inboundMetrics?.alert ?? null;
  const inboundAlertRecommendation = inboundAlert?.recommendation ?? null;
  const inboundAlertStatusColor =
    inboundAlert?.status === "at_or_above_threshold"
      ? "#ff7070"
      : inboundAlert?.status === "cooldown"
        ? "#ffbe63"
        : "#68dca0";
  const inboundAlertStatusLabel =
    inboundAlert?.status === "at_or_above_threshold"
      ? "Threshold exceeded"
      : inboundAlert?.status === "cooldown"
        ? `Cooldown (${inboundAlert.cooldownRemainingMinutes}m remaining)`
        : "Below threshold";
  const maxInboundBarValue = Math.max(
    1,
    ...inboundSeries.map((point) => point.failed + point.processed + point.processing)
  );

  return (
    <AppShell title="Admin Panel" subtitle="Create users, assign roles, and provision mailboxes.">
      <div className="app-content admin-layout">
        <div className="panel admin-nav">
          {ADMIN_SECTIONS.map((section) => {
            const count = getSectionCount(section.key);
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={`admin-nav-button${activeSection === section.key ? " active" : ""}`}
              >
                <span>{section.label}</span>
                {typeof count === "number" ? (
                  <span className="admin-nav-count">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="admin-panel">
          {activeSection === "create-user" ? (
            <section className="panel">
              <h2 style={{ marginBottom: 12 }}>Create User</h2>
              <form onSubmit={handleCreate} style={{ display: "grid", gap: 12 }}>
                <label>
                  Email
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, email: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Display name
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, displayName: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  Temporary password
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                    required
                    minLength={8}
                  />
                </label>
                <label>
                  Role
                  <select
                    value={form.roleId}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, roleId: event.target.value }))
                    }
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 10,
                    border: "none",
                    background: "linear-gradient(135deg, var(--accent-strong), var(--accent))",
                    color: "#081018",
                    cursor: "pointer"
                  }}
                >
                  {loading ? "Creating..." : "Create user"}
                </button>
              </form>
            </section>
          ) : null}

          {activeSection === "sla" ? (
            <section className="panel">
              <h2 style={{ marginBottom: 12 }}>SLA Targets</h2>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  setSlaStatus("saving");
                  const res = await fetch("/api/admin/sla", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(sla)
                  });
                  if (!res.ok) {
                    setSlaStatus("error");
                    return;
                  }
                  setSlaStatus("saved");
                  setTimeout(() => setSlaStatus("idle"), 2000);
                }}
                style={{ display: "grid", gap: 12 }}
              >
                <label>
                  First response target (minutes)
                  <input
                    type="number"
                    min={1}
                    value={sla.firstResponseMinutes}
                    onChange={(event) =>
                      setSla((prev) => ({
                        ...prev,
                        firstResponseMinutes: Number(event.target.value)
                      }))
                    }
                  />
                </label>
                <label>
                  Resolution target (minutes)
                  <input
                    type="number"
                    min={1}
                    value={sla.resolutionMinutes}
                    onChange={(event) =>
                      setSla((prev) => ({
                        ...prev,
                        resolutionMinutes: Number(event.target.value)
                      }))
                    }
                  />
                </label>
                {slaStatus === "error" ? (
                  <p style={{ color: "var(--danger)" }}>Failed to save SLA targets.</p>
                ) : null}
                {slaStatus === "saved" ? (
                  <p style={{ color: "var(--accent)" }}>SLA targets updated.</p>
                ) : null}
                <button
                  type="submit"
                  disabled={slaStatus === "saving"}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 10,
                    border: "none",
                    background: "linear-gradient(135deg, var(--accent-strong), var(--accent))",
                    color: "#081018",
                    cursor: "pointer"
                  }}
                >
                  {slaStatus === "saving" ? "Saving..." : "Save SLA targets"}
                </button>
              </form>
            </section>
          ) : null}

          {activeSection === "tags" ? (
            <div className="panel">
              <TagsClient compact />
            </div>
          ) : null}

          {activeSection === "spam-rules" ? (
            <div className="panel">
              <SpamRulesClient compact />
            </div>
          ) : null}

          {activeSection === "agent" ? (
            <div className="panel">
              <AgentIntegrationClient compact />
            </div>
          ) : null}

          {activeSection === "whatsapp" ? (
            <div className="panel">
              <WhatsAppClient compact />
            </div>
          ) : null}

          {activeSection === "profile-lookup" ? (
            <div className="panel">
              <ProfileLookupClient compact />
            </div>
          ) : null}

          {activeSection === "security" ? (
            <section className="panel">
              <h2 style={{ marginBottom: 12 }}>Security</h2>
              <p style={{ color: "var(--muted)" }}>
                Runtime controls are configured via environment variables. This view shows current
                status and recommendations.
              </p>
              {securityError ? <p style={{ color: "var(--danger)" }}>{securityError}</p> : null}
              {!security ? (
                <p>Loading security status...</p>
              ) : (
                <div style={{ display: "grid", gap: 16 }}>
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: 12,
                      background: "rgba(10, 12, 18, 0.6)"
                    }}
                  >
                    <h3 style={{ marginTop: 0 }}>Secrets at Rest</h3>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      AGENT_SECRET_KEY: {encryptionEnabled ? "Configured" : "Missing"}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      Agent integrations encrypted: {security.agentIntegrationStats.encrypted}/
                      {security.agentIntegrationStats.total}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      WhatsApp access tokens encrypted: {security.whatsappTokenStats.encrypted}/
                      {security.whatsappTokenStats.total}
                      {security.whatsappTokenStats.missing
                        ? ` · Missing: ${security.whatsappTokenStats.missing}`
                        : ""}
                    </div>
                    {!encryptionEnabled ? (
                      <p style={{ color: "var(--danger)", fontSize: 12 }}>
                        Set AGENT_SECRET_KEY to encrypt agent secrets and WhatsApp tokens at rest.
                      </p>
                    ) : null}
                    {encryptionEnabled &&
                    (security.agentIntegrationStats.unencrypted > 0 ||
                      security.whatsappTokenStats.unencrypted > 0) ? (
                      <p style={{ color: "var(--muted)", fontSize: 12 }}>
                        Some secrets were saved before encryption. Re-save them in Admin to encrypt.
                      </p>
                    ) : null}
                  </div>

                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: 12,
                      background: "rgba(10, 12, 18, 0.6)"
                    }}
                  >
                    <h3 style={{ marginTop: 0 }}>Inbound Security</h3>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      INBOUND_SHARED_SECRET: {inboundSecretEnabled ? "Configured" : "Missing"}
                    </div>
                    {!inboundSecretEnabled ? (
                      <p style={{ color: "var(--danger)", fontSize: 12 }}>
                        Set INBOUND_SHARED_SECRET to protect inbound webhooks and retries.
                      </p>
                    ) : null}
                  </div>

                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: 12,
                      background: "rgba(10, 12, 18, 0.6)"
                    }}
                  >
                    <h3 style={{ marginTop: 0 }}>IP Allowlists</h3>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      Admin allowlist:{" "}
                      {adminAllowlist.length ? adminAllowlist.join(", ") : "None (open)"}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      Agent allowlist:{" "}
                      {agentAllowlist.length ? agentAllowlist.join(", ") : "None (open)"}
                    </div>
                    {security.clientIp ? (
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                        Your current IP: {security.clientIp}
                      </div>
                    ) : null}
                    <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                      Update allowlists in `.env` and restart the app:
                    </p>
                    <pre
                      style={{
                        margin: 0,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "rgba(10, 12, 18, 0.7)",
                        fontSize: 12,
                        whiteSpace: "pre-wrap"
                      }}
                    >
                      {allowlistSnippet}
                    </pre>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {activeSection === "users" ? (
            <section className="panel">
              <h2 style={{ marginBottom: 12 }}>Users</h2>
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="Search name or email..."
                  value={userQuery}
                  onChange={(event) => setUserQuery(event.target.value)}
                />
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {filteredUsers.length === 0 ? (
                  <p>No users match your search.</p>
                ) : (
                  filteredUsers.map((user) => {
                    const roleLabel = (
                      user.role_name ?? roleNameById.get(user.role_id ?? "") ?? "unknown"
                    ).toLowerCase();
                    const safeRole = roleLabel.replace(/[^a-z0-9_-]/g, "");
                    return (
                      <div
                        key={user.id}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          padding: 12,
                          background: "rgba(10, 12, 18, 0.6)"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <strong>{user.display_name}</strong>
                          <span className={`role-badge role-${safeRole}`}>{roleLabel}</span>
                        </div>
                        <p>{user.email}</p>
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      <label>
                        Role
                        <select
                          value={user.role_id ?? ""}
                          onChange={(event) =>
                            updateUser(user.id, { roleId: event.target.value })
                          }
                          style={{ marginLeft: 8, padding: "6px 8px" }}
                        >
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Status
                        <select
                          value={user.is_active ? "active" : "inactive"}
                          onChange={(event) =>
                            updateUser(user.id, { isActive: event.target.value === "active" })
                          }
                          style={{ marginLeft: 8, padding: "6px 8px" }}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => resetPassword(user.id)}
                        disabled={resettingUserId === user.id}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-2)",
                          color: "var(--text)",
                          cursor: "pointer"
                        }}
                      >
                        {resettingUserId === user.id ? "Generating..." : "Reset password"}
                      </button>
                      {updatingUserId === user.id ? (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>Saving...</span>
                      ) : null}
                    </div>
                    {resetLinks[user.id] ? (
                      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                        Reset link: <span style={{ color: "var(--text)" }}>{resetLinks[user.id]}</span>
                      </p>
                    ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          ) : null}

          {activeSection === "inbound" ? (
            <section className="panel">
              <h2 style={{ marginBottom: 12 }}>Inbound Failures</h2>
              <form
                onSubmit={saveInboundAlertSettings}
                style={{
                  display: "grid",
                  gap: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 12,
                  background: "rgba(10, 12, 18, 0.6)",
                  marginBottom: 12
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong>Alert Settings</strong>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    Source: {inboundAlertConfig?.source ?? "unknown"}
                  </span>
                </div>
                <label>
                  Webhook URL
                  <input
                    type="url"
                    placeholder="https://hooks.slack.com/services/..."
                    value={inboundAlertForm.webhookUrl}
                    onChange={(event) =>
                      setInboundAlertForm((prev) => ({
                        ...prev,
                        webhookUrl: event.target.value
                      }))
                    }
                  />
                </label>
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))"
                  }}
                >
                  <label>
                    Threshold
                    <input
                      type="number"
                      min={1}
                      value={inboundAlertForm.threshold}
                      onChange={(event) =>
                        setInboundAlertForm((prev) => ({
                          ...prev,
                          threshold: Number(event.target.value) || 1
                        }))
                      }
                    />
                  </label>
                  <label>
                    Window (minutes)
                    <input
                      type="number"
                      min={1}
                      value={inboundAlertForm.windowMinutes}
                      onChange={(event) =>
                        setInboundAlertForm((prev) => ({
                          ...prev,
                          windowMinutes: Number(event.target.value) || 1
                        }))
                      }
                    />
                  </label>
                  <label>
                    Cooldown (minutes)
                    <input
                      type="number"
                      min={1}
                      value={inboundAlertForm.cooldownMinutes}
                      onChange={(event) =>
                        setInboundAlertForm((prev) => ({
                          ...prev,
                          cooldownMinutes: Number(event.target.value) || 1
                        }))
                      }
                    />
                  </label>
                </div>
                {inboundAlertConfig?.updatedAt ? (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Last updated: {new Date(inboundAlertConfig.updatedAt).toLocaleString()}
                  </div>
                ) : null}
                {inboundAlertConfigError ? (
                  <p style={{ color: "var(--danger)", margin: 0 }}>{inboundAlertConfigError}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={savingInboundAlertConfig}
                  style={{
                    justifySelf: "start",
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    cursor: "pointer"
                  }}
                >
                  {savingInboundAlertConfig ? "Saving..." : "Save alert settings"}
                </button>
              </form>
              <button
                type="button"
                onClick={retryInbound}
                disabled={retryingInbound}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  cursor: "pointer",
                  marginBottom: 12
                }}
              >
                {retryingInbound ? "Retrying..." : "Retry failed inbound"}
              </button>
              <button
                type="button"
                onClick={checkInboundAlerts}
                disabled={checkingAlerts}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer",
                  marginLeft: 8
                }}
              >
                {checkingAlerts ? "Checking..." : "Send alert check"}
              </button>
              {inboundMetricsError ? (
                <p style={{ color: "var(--danger)", marginTop: 10 }}>{inboundMetricsError}</p>
              ) : null}
              {inboundMetrics ? (
                <div style={{ display: "grid", gap: 12, marginTop: 12, marginBottom: 14 }}>
                  {inboundAlert && inboundAlertRecommendation ? (
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 12,
                        background: "rgba(10, 12, 18, 0.6)",
                        display: "grid",
                        gap: 8
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <strong>Alert Health ({inboundAlert.windowMinutes}m window)</strong>
                        <span style={{ color: inboundAlertStatusColor, fontWeight: 700 }}>{inboundAlertStatusLabel}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        Failures now: {inboundAlert.currentFailures} / threshold {inboundAlert.threshold} · Cooldown{" "}
                        {inboundAlert.cooldownMinutes}m · Source {inboundAlert.source}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        Webhook {inboundAlert.webhookConfigured ? "configured" : "missing"} · Last sent{" "}
                        {inboundAlert.lastSentAt ? new Date(inboundAlert.lastSentAt).toLocaleString() : "never"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        Suggested threshold range: {inboundAlertRecommendation.suggestedMinThreshold}-
                        {inboundAlertRecommendation.suggestedMaxThreshold} (avg{" "}
                        {inboundAlertRecommendation.avgBucketFailures.toFixed(2)}, p95{" "}
                        {inboundAlertRecommendation.p95BucketFailures.toFixed(2)}, sample windows{" "}
                        {inboundAlertRecommendation.bucketCount})
                      </div>
                      {!inboundAlertRecommendation.inRange ? (
                        <button
                          type="button"
                          onClick={() =>
                            setInboundAlertForm((prev) => ({
                              ...prev,
                              threshold: inboundAlertRecommendation.suggestedMaxThreshold
                            }))
                          }
                          style={{
                            justifySelf: "start",
                            padding: "7px 10px",
                            borderRadius: 8,
                            border: "1px solid var(--border)",
                            background: "var(--surface-2)",
                            color: "var(--text)",
                            cursor: "pointer"
                          }}
                        >
                          Use suggested threshold ({inboundAlertRecommendation.suggestedMaxThreshold})
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))"
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)"
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Failed Queue</div>
                      <strong style={{ fontSize: 22 }}>{inboundMetrics.summary.failedQueue}</strong>
                    </div>
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)"
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Due Retry Now</div>
                      <strong style={{ fontSize: 22 }}>{inboundMetrics.summary.dueRetryNow}</strong>
                    </div>
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)"
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Processed ({inboundWindowHours}h)</div>
                      <strong style={{ fontSize: 22 }}>{inboundMetrics.summary.processedWindow}</strong>
                    </div>
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)"
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Attempts ({inboundWindowHours}h)</div>
                      <strong style={{ fontSize: 22 }}>{inboundMetrics.summary.attemptsWindow}</strong>
                    </div>
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)"
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Retry Processed ({inboundWindowHours}h)</div>
                      <strong style={{ fontSize: 22 }}>{inboundMetrics.summary.retryProcessedWindow}</strong>
                    </div>
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)"
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Retry Failed ({inboundWindowHours}h)</div>
                      <strong style={{ fontSize: 22 }}>{inboundMetrics.summary.retryFailedWindow}</strong>
                    </div>
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)"
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>Oldest Failed Age</div>
                      <strong style={{ fontSize: 22 }}>
                        {inboundMetrics.summary.oldestFailedAgeMinutes === null
                          ? "—"
                          : `${inboundMetrics.summary.oldestFailedAgeMinutes}m`}
                      </strong>
                    </div>
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)"
                      }}
                    >
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>High Attempt Queue (&gt;=5)</div>
                      <strong style={{ fontSize: 22 }}>{inboundMetrics.summary.highAttemptQueue}</strong>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        Max {inboundMetrics.summary.maxFailedAttemptCount} · p95{" "}
                        {inboundMetrics.summary.p95FailedAttemptCount}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: 12,
                      background: "rgba(10, 12, 18, 0.6)"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <strong>Inbound Trend ({inboundWindowHours}h)</strong>
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>
                        Updated {new Date(inboundMetrics.generatedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    {inboundSeries.length === 0 ? (
                      <p style={{ margin: 0, color: "var(--muted)" }}>No inbound activity in this window.</p>
                    ) : (
                      <>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: `repeat(${inboundSeries.length}, minmax(0, 1fr))`,
                            gap: 4,
                            alignItems: "end",
                            height: 124
                          }}
                        >
                          {inboundSeries.map((point) => {
                            const failedHeight = (point.failed / maxInboundBarValue) * 100;
                            const processedHeight = (point.processed / maxInboundBarValue) * 100;
                            const processingHeight = (point.processing / maxInboundBarValue) * 100;
                            return (
                              <div
                                key={point.hour}
                                title={`${new Date(point.hour).toLocaleString()} | failed: ${point.failed}, processed: ${point.processed}, processing: ${point.processing}`}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  justifyContent: "flex-end",
                                  gap: 2,
                                  height: "100%"
                                }}
                              >
                                <div
                                  style={{
                                    height: `${Math.max(0, failedHeight)}%`,
                                    minHeight: point.failed ? 3 : 0,
                                    borderRadius: 4,
                                    background: "rgba(255, 112, 112, 0.9)"
                                  }}
                                />
                                <div
                                  style={{
                                    height: `${Math.max(0, processingHeight)}%`,
                                    minHeight: point.processing ? 3 : 0,
                                    borderRadius: 4,
                                    background: "rgba(255, 190, 99, 0.9)"
                                  }}
                                />
                                <div
                                  style={{
                                    height: `${Math.max(0, processedHeight)}%`,
                                    minHeight: point.processed ? 3 : 0,
                                    borderRadius: 4,
                                    background: "rgba(104, 220, 160, 0.9)"
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                          <span>Red: Failed</span>
                          <span>Amber: Processing</span>
                          <span>Green: Processed</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
              {inboundFailures.length === 0 ? (
                <p>No failed inbound events.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {inboundFailures.map((event) => (
                    <div
                      key={event.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)",
                        fontSize: 13
                      }}
                    >
                      <div style={{ color: "var(--muted)" }}>
                        Attempts: {event.attempt_count} · Next:{" "}
                        {event.next_attempt_at
                          ? new Date(event.next_attempt_at).toLocaleString()
                          : "—"}
                      </div>
                      <div style={{ color: "var(--muted)" }}>
                        {event.last_error ?? "Unknown error"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeSection === "spam-review" ? (
            <section className="panel">
              <h2 style={{ marginBottom: 12 }}>Spam Review</h2>
              {spamMessages.length === 0 ? (
                <p>No spam messages flagged.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {spamMessages.map((message) => (
                    <div
                      key={message.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)",
                        fontSize: 13
                      }}
                    >
                      <div style={{ color: "var(--muted)" }}>
                        {message.mailbox_address} · {message.received_at ?? "—"}
                      </div>
                      <div>
                        <strong>{message.subject ?? "(no subject)"}</strong>
                      </div>
                      <div style={{ color: "var(--muted)" }}>
                        From: {message.from_email} · Reason: {message.spam_reason ?? "manual"}
                      </div>
                      <button
                        type="button"
                        onClick={() => unspamMessage(message.id)}
                        style={{
                          marginTop: 8,
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-2)",
                          color: "var(--text)",
                          cursor: "pointer"
                        }}
                      >
                        Not spam
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeSection === "audit-log" ? (
            <section className="panel">
              <h2 style={{ marginBottom: 12 }}>Audit Log</h2>
              {auditLogs.length === 0 ? (
                <p>No audit entries yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(10, 12, 18, 0.6)",
                        fontSize: 13
                      }}
                    >
                      <div style={{ color: "var(--muted)" }}>
                        {new Date(log.created_at).toLocaleString()}
                      </div>
                      <div>
                        <strong>{log.action}</strong> · {log.entity_type}
                      </div>
                      <div style={{ color: "var(--muted)" }}>
                        {log.actor_name ?? log.actor_email ?? "System"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
