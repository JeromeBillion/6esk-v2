"use client";

import { useEffect, useState } from "react";

type WhatsAppAccount = {
  id: string;
  provider: string;
  phoneNumber: string;
  wabaId: string | null;
  accessToken: string;
  verifyToken: string;
  status: "active" | "paused" | "inactive";
  createdAt?: string | null;
  updatedAt?: string | null;
};

type WhatsAppTemplate = {
  id: string;
  provider: string;
  name: string;
  language: string;
  category?: string | null;
  status: "active" | "paused";
  components?: Array<Record<string, unknown>> | null;
};

type WhatsAppOutboxMetrics = {
  account: {
    id: string;
    provider: string;
    phoneNumber: string;
    status: string;
    updatedAt: string;
  } | null;
  queue: {
    queued: number;
    dueNow: number;
    processing: number;
    failed: number;
    sentTotal: number;
    sent24h: number;
    nextAttemptAt: string | null;
    lastSentAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
  };
};

type WhatsAppClientProps = {
  compact?: boolean;
};

export default function WhatsAppClient({ compact = false }: WhatsAppClientProps) {
  const [account, setAccount] = useState<WhatsAppAccount | null>(null);
  const [form, setForm] = useState({
    provider: "meta",
    phoneNumber: "",
    wabaId: "",
    accessToken: "",
    verifyToken: "",
    status: "inactive" as "active" | "paused" | "inactive"
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingOutbox, setSendingOutbox] = useState(false);
  const [outboxResult, setOutboxResult] = useState<string | null>(null);
  const [outboxMetrics, setOutboxMetrics] = useState<WhatsAppOutboxMetrics | null>(null);
  const [loadingOutboxMetrics, setLoadingOutboxMetrics] = useState(false);
  const [outboxMetricsError, setOutboxMetricsError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templateForm, setTemplateForm] = useState({
    name: "",
    language: "en_US",
    category: "",
    status: "active" as "active" | "paused",
    componentsJson: ""
  });
  const [templateEditingId, setTemplateEditingId] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  async function loadOutboxMetrics() {
    try {
      setLoadingOutboxMetrics(true);
      const res = await fetch("/api/admin/whatsapp/outbox");
      if (!res.ok) {
        setOutboxMetrics(null);
        setOutboxMetricsError("Failed to load outbox metrics.");
        setLoadingOutboxMetrics(false);
        return;
      }
      const payload = (await res.json()) as WhatsAppOutboxMetrics;
      setOutboxMetrics(payload);
      setOutboxMetricsError(null);
      setLoadingOutboxMetrics(false);
    } catch (error) {
      setOutboxMetrics(null);
      setOutboxMetricsError("Failed to load outbox metrics.");
      setLoadingOutboxMetrics(false);
    }
  }

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/admin/whatsapp");
      if (!res.ok) return;
      const payload = await res.json();
      if (payload.account) {
        setAccount(payload.account);
        setForm({
          provider: payload.account.provider ?? "meta",
          phoneNumber: payload.account.phoneNumber ?? "",
          wabaId: payload.account.wabaId ?? "",
          accessToken: payload.account.accessToken ?? "",
          verifyToken: payload.account.verifyToken ?? "",
          status: payload.account.status ?? "inactive"
        });
      }
    }

    async function loadTemplates() {
      const res = await fetch("/api/admin/whatsapp/templates");
      if (!res.ok) return;
      const payload = await res.json();
      setTemplates(payload.templates ?? []);
    }

    void load();
    void loadTemplates();
    void loadOutboxMetrics();
  }, []);

  useEffect(() => {
    if (!copyMessage) return;
    const timer = setTimeout(() => setCopyMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [copyMessage]);

  function generateVerifyToken() {
    const token =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setForm((prev) => ({ ...prev, verifyToken: token }));
  }

  async function copyToClipboard(value: string, label: string) {
    if (!value) {
      setCopyMessage(`No ${label} available`);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied`);
    } catch (error) {
      setCopyMessage(`Failed to copy ${label}`);
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setSaved(false);
    setError(null);

    const res = await fetch("/api/admin/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: form.provider,
        phoneNumber: form.phoneNumber,
        wabaId: form.wabaId || null,
        accessToken: form.accessToken || null,
        verifyToken: form.verifyToken || null,
        status: form.status
      })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? "Failed to save WhatsApp settings");
      setLoading(false);
      return;
    }

    setSaved(true);
    setLoading(false);
  }

  async function runOutbox() {
    setSendingOutbox(true);
    setOutboxResult(null);
    const res = await fetch("/api/admin/whatsapp/outbox?limit=25", { method: "POST" });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setOutboxResult(payload.error ?? "Failed to run outbox");
      setSendingOutbox(false);
      return;
    }
    const payload = await res.json();
    setOutboxResult(`Delivered ${payload.delivered ?? 0}, skipped ${payload.skipped ?? 0}`);
    await loadOutboxMetrics();
    setSendingOutbox(false);
  }

  function resetTemplateForm() {
    setTemplateForm({
      name: "",
      language: "en_US",
      category: "",
      status: "active",
      componentsJson: ""
    });
    setTemplateEditingId(null);
    setTemplateError(null);
  }

  function startTemplateEdit(template: WhatsAppTemplate) {
    setTemplateForm({
      name: template.name,
      language: template.language,
      category: template.category ?? "",
      status: template.status,
      componentsJson: template.components ? JSON.stringify(template.components, null, 2) : ""
    });
    setTemplateEditingId(template.id);
    setTemplateError(null);
  }

  function formatComponentsJson() {
    if (!templateForm.componentsJson.trim()) {
      return;
    }
    try {
      const parsed = JSON.parse(templateForm.componentsJson);
      setTemplateForm((prev) => ({ ...prev, componentsJson: JSON.stringify(parsed, null, 2) }));
      setTemplateError(null);
    } catch (error) {
      setTemplateError("Components JSON is invalid.");
    }
  }

  async function handleTemplateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTemplateError(null);

    let components: Array<Record<string, unknown>> | null = null;
    if (templateForm.componentsJson.trim()) {
      try {
        const parsed = JSON.parse(templateForm.componentsJson);
        components = Array.isArray(parsed) ? parsed : null;
      } catch (error) {
        setTemplateError("Components JSON is invalid.");
        return;
      }
    }

    const payload = {
      provider: form.provider ?? "meta",
      name: templateForm.name.trim(),
      language: templateForm.language.trim() || "en_US",
      category: templateForm.category.trim() || null,
      status: templateForm.status,
      components
    };

    if (!payload.name) {
      setTemplateError("Template name is required.");
      return;
    }

    const res = await fetch(
      templateEditingId
        ? `/api/admin/whatsapp/templates/${templateEditingId}`
        : "/api/admin/whatsapp/templates",
      {
        method: templateEditingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    if (!res.ok) {
      const responsePayload = await res.json().catch(() => ({}));
      setTemplateError(responsePayload.error ?? "Failed to save template.");
      return;
    }

    const refresh = await fetch("/api/admin/whatsapp/templates");
    if (refresh.ok) {
      const data = await refresh.json();
      setTemplates(data.templates ?? []);
    }
    resetTemplateForm();
  }

  async function deleteTemplate(templateId: string) {
    const res = await fetch(`/api/admin/whatsapp/templates/${templateId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      const refresh = await fetch("/api/admin/whatsapp/templates");
      if (refresh.ok) {
        const data = await refresh.json();
        setTemplates(data.templates ?? []);
      }
    }
  }

  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp/inbound` : "";
  const statusTone =
    form.status === "active"
      ? "#7ff5a2"
      : form.status === "paused"
        ? "var(--muted)"
        : "var(--danger)";
  const statusLabel =
    form.status === "active" ? "Active" : form.status === "paused" ? "Paused" : "Inactive";
  const statusWarnings: string[] = [];
  if (form.status === "active" && !form.accessToken.trim()) {
    statusWarnings.push("Access token is required for Active status.");
  }
  if (form.provider === "meta" && !form.verifyToken.trim()) {
    statusWarnings.push("Verify token is empty. Meta webhook verification will fail.");
  }
  const lastUpdated = account?.updatedAt ? new Date(account.updatedAt).toLocaleString() : null;

  function getTemplateParamCount(template: WhatsAppTemplate) {
    if (!template.components) return 0;
    let count = 0;
    for (const component of template.components) {
      if (!component || typeof component !== "object") continue;
      const params = (component as Record<string, unknown>).parameters;
      if (Array.isArray(params)) {
        count += params.length;
      }
    }
    return count;
  }

  return (
    <section style={{ marginTop: compact ? 0 : 40 }}>
      <h2 style={{ marginBottom: 12 }}>WhatsApp Business</h2>
      <p style={{ marginBottom: 12 }}>
        Connect your WhatsApp Business account. Webhook verification must be configured in Meta.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "rgba(10, 12, 18, 0.6)",
            color: statusTone,
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.08em"
          }}
        >
          {statusLabel}
        </span>
        {lastUpdated ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Updated {lastUpdated}</span>
        ) : null}
      </div>
      {statusWarnings.length ? (
        <div style={{ display: "grid", gap: 6, marginBottom: 16, fontSize: 12, color: "var(--danger)" }}>
          {statusWarnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}
      <form onSubmit={handleSave} style={{ display: "grid", gap: 12 }}>
        <label>
          Provider
          <select
            value={form.provider}
            onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}
          >
            <option value="meta">Meta Cloud API</option>
            <option value="twilio">Twilio</option>
            <option value="messagebird">MessageBird</option>
          </select>
        </label>
        <label>
          {form.provider === "meta" ? "Phone number ID" : "Phone number"}
          <input
            type="text"
            value={form.phoneNumber}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, phoneNumber: event.target.value }))
            }
            required
          />
          {form.provider === "meta" ? (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Meta Cloud API requires the Phone Number ID (not the E.164 phone).
            </span>
          ) : null}
        </label>
        <label>
          WABA ID
          <input
            type="text"
            value={form.wabaId}
            onChange={(event) => setForm((prev) => ({ ...prev, wabaId: event.target.value }))}
          />
        </label>
        <label>
          Access token
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type={showAccessToken ? "text" : "password"}
              value={form.accessToken}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, accessToken: event.target.value }))
              }
            />
            <button
              type="button"
              onClick={() => setShowAccessToken((prev) => !prev)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                cursor: "pointer"
              }}
            >
              {showAccessToken ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        <label>
          Verify token
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={form.verifyToken}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, verifyToken: event.target.value }))
              }
            />
            <button
              type="button"
              onClick={generateVerifyToken}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                cursor: "pointer"
              }}
            >
              Generate
            </button>
            <button
              type="button"
              onClick={() => copyToClipboard(form.verifyToken, "Verify token")}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                cursor: "pointer"
              }}
            >
              Copy
            </button>
          </div>
        </label>
        <label>
          Status
          <select
            value={form.status}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                status: event.target.value as "active" | "paused" | "inactive"
              }))
            }
          >
            <option value="inactive">Inactive</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </label>
        {account?.id ? (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            Account ID: <span style={{ color: "var(--text)" }}>{account.id}</span>
          </p>
        ) : null}
        {webhookUrl ? (
          <label>
            Webhook URL
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" value={webhookUrl} readOnly />
              <button
                type="button"
                onClick={() => copyToClipboard(webhookUrl, "Webhook URL")}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  cursor: "pointer"
                }}
              >
                Copy
              </button>
            </div>
          </label>
        ) : null}
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        {saved ? <p style={{ color: "var(--accent)" }}>Saved.</p> : null}
        {copyMessage ? <p style={{ color: "var(--muted)" }}>{copyMessage}</p> : null}
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
          {loading ? "Saving..." : "Save WhatsApp settings"}
        </button>
      </form>
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={runOutbox}
            disabled={sendingOutbox}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface-2)",
              color: "var(--text)",
              cursor: "pointer"
            }}
          >
            {sendingOutbox ? "Sending..." : "Process outbound queue"}
          </button>
          <button
            type="button"
            onClick={loadOutboxMetrics}
            disabled={loadingOutboxMetrics}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text)",
              cursor: "pointer"
            }}
          >
            {loadingOutboxMetrics ? "Refreshing..." : "Refresh queue metrics"}
          </button>
        </div>
        {outboxResult ? (
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{outboxResult}</p>
        ) : null}
        {outboxMetricsError ? (
          <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{outboxMetricsError}</p>
        ) : null}
        {outboxMetrics ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              marginTop: 10,
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Account status: {outboxMetrics.account?.status ?? "not configured"} · Provider:{" "}
              {outboxMetrics.account?.provider ?? "—"}
            </div>
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))"
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Queued</div>
                <strong>{outboxMetrics.queue.queued}</strong>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Due now</div>
                <strong>{outboxMetrics.queue.dueNow}</strong>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Processing</div>
                <strong>{outboxMetrics.queue.processing}</strong>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Failed</div>
                <strong>{outboxMetrics.queue.failed}</strong>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Sent (24h)</div>
                <strong>{outboxMetrics.queue.sent24h}</strong>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Next attempt:{" "}
              {outboxMetrics.queue.nextAttemptAt
                ? new Date(outboxMetrics.queue.nextAttemptAt).toLocaleString()
                : "—"}
              {" · "}
              Last sent:{" "}
              {outboxMetrics.queue.lastSentAt
                ? new Date(outboxMetrics.queue.lastSentAt).toLocaleString()
                : "—"}
            </div>
            {outboxMetrics.queue.lastError ? (
              <div style={{ fontSize: 12, color: "var(--danger)" }}>
                Last outbox error: {outboxMetrics.queue.lastError}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 12 }}>Templates</h3>
        <form onSubmit={handleTemplateSubmit} style={{ display: "grid", gap: 12 }}>
          <label>
            Template name
            <input
              type="text"
              value={templateForm.name}
              onChange={(event) =>
                setTemplateForm((prev) => ({ ...prev, name: event.target.value }))
              }
              required
            />
          </label>
          <label>
            Language
            <input
              type="text"
              value={templateForm.language}
              onChange={(event) =>
                setTemplateForm((prev) => ({ ...prev, language: event.target.value }))
              }
            />
          </label>
          <label>
            Category
            <input
              type="text"
              value={templateForm.category}
              onChange={(event) =>
                setTemplateForm((prev) => ({ ...prev, category: event.target.value }))
              }
            />
          </label>
          <label>
            Status
            <select
              value={templateForm.status}
              onChange={(event) =>
                setTemplateForm((prev) => ({
                  ...prev,
                  status: event.target.value as "active" | "paused"
                }))
              }
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
          <label>
            Components JSON (optional)
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="button"
                onClick={formatComponentsJson}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer"
                }}
              >
                Format JSON
              </button>
            </div>
            <textarea
              rows={4}
              value={templateForm.componentsJson}
              onChange={(event) =>
                setTemplateForm((prev) => ({ ...prev, componentsJson: event.target.value }))
              }
              placeholder='[{"type":"body","parameters":[{"type":"text","text":"{{1}}"}]}]'
            />
          </label>
          {templateError ? <p style={{ color: "var(--danger)" }}>{templateError}</p> : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="submit"
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg, var(--accent-strong), var(--accent))",
                color: "#081018",
                cursor: "pointer"
              }}
            >
              {templateEditingId ? "Update template" : "Add template"}
            </button>
            {templateEditingId ? (
              <button
                type="button"
                onClick={resetTemplateForm}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
          {templates.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No templates saved yet.</p>
          ) : (
            templates.map((template) => (
              <div
                key={template.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 10,
                  background: "rgba(10, 12, 18, 0.6)"
                }}
              >
                <strong>
                  {template.name} · {template.language}
                </strong>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {template.category ? `Category: ${template.category} · ` : ""}
                  Status: {template.status}
                  {template.components ? ` · Params: ${getTemplateParamCount(template)}` : ""}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => startTemplateEdit(template)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--surface-2)",
                      color: "var(--text)",
                      cursor: "pointer"
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTemplate(template.id)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--muted)",
                      cursor: "pointer"
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
