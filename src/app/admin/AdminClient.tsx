"use client";

import { useEffect, useState } from "react";
import AppShell from "@/app/components/AppShell";
import TagsClient from "./TagsClient";
import AgentIntegrationClient from "./AgentIntegrationClient";
import SpamRulesClient from "./SpamRulesClient";

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

export default function AdminClient() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
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
  const [retryingInbound, setRetryingInbound] = useState(false);
  const [checkingAlerts, setCheckingAlerts] = useState(false);

  async function loadData() {
    const [rolesRes, usersRes, slaRes, logsRes, spamRes, inboundRes] = await Promise.all([
      fetch("/api/admin/roles"),
      fetch("/api/admin/users"),
      fetch("/api/admin/sla"),
      fetch("/api/admin/audit-logs?limit=50"),
      fetch("/api/admin/spam-messages?limit=50"),
      fetch("/api/admin/inbound/failed?limit=50")
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

  async function unspamMessage(messageId: string) {
    await fetch(`/api/messages/${messageId}/spam`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSpam: false, reason: null })
    });
    await loadData();
  }

  return (
    <AppShell title="Lead Admin Panel" subtitle="Create users, assign roles, and provision mailboxes.">
      <div className="app-content">
        <section>
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

        <section>
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

        <TagsClient />

        <SpamRulesClient />

        <AgentIntegrationClient />

        <section>
          <h2 style={{ marginBottom: 12 }}>Users</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {users.map((user) => (
              <div
                key={user.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 12,
                  background: "rgba(10, 12, 18, 0.6)"
                }}
              >
                <strong>{user.display_name}</strong>
                <p>{user.email}</p>
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  <label>
                    Role
                    <select
                      value={user.role_id ?? ""}
                      onChange={(event) => updateUser(user.id, { roleId: event.target.value })}
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
            ))}
          </div>
        </section>

        <section>
          <h2 style={{ marginBottom: 12 }}>Inbound Failures</h2>
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
                    {event.next_attempt_at ? new Date(event.next_attempt_at).toLocaleString() : "—"}
                  </div>
                  <div style={{ color: "var(--muted)" }}>{event.last_error ?? "Unknown error"}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
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

        <section>
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
      </div>
    </AppShell>
  );
}
