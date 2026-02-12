"use client";

import { useEffect, useState } from "react";

type AgentIntegration = {
  id: string;
  name: string;
  base_url: string;
  shared_secret: string;
  status: "active" | "paused";
  policy_mode: "draft_only" | "auto_send";
  capabilities?: Record<string, unknown>;
  policy?: Record<string, unknown>;
};

type AgentOutboxMetrics = {
  integrationId: string;
  integrationStatus: "active" | "paused" | string;
  throughput: {
    configuredMaxEventsPerRun: number | null;
    effectiveLimit: number;
  };
  queue: {
    pending: number;
    dueNow: number;
    processing: number;
    failed: number;
    deliveredTotal: number;
    delivered24h: number;
    nextAttemptAt: string | null;
    lastDeliveredAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
  };
};

type AgentIntegrationClientProps = {
  compact?: boolean;
};

function parseMaxEventsPerRun(capabilities?: Record<string, unknown>) {
  const raw = capabilities?.max_events_per_run;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return "";
  }
  return String(Math.min(Math.trunc(parsed), 50));
}

export default function AgentIntegrationClient({ compact = false }: AgentIntegrationClientProps) {
  const [agent, setAgent] = useState<AgentIntegration | null>(null);
  const [form, setForm] = useState({
    name: "6esk AI Agent",
    baseUrl: "",
    sharedSecret: "",
    status: "active" as "active" | "paused",
    policyMode: "draft_only" as "draft_only" | "auto_send",
    maxEventsPerRun: "",
    policyJson: "{\n  \"working_hours\": {\n    \"timezone\": \"Africa/Johannesburg\",\n    \"days\": [0,1,2,3,4,5,6],\n    \"start\": \"00:00\",\n    \"end\": \"23:59\"\n  },\n  \"escalation\": {\n    \"out_of_hours\": \"draft_only\",\n    \"tag\": \"urgent\"\n  }\n}"
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [outboxMetrics, setOutboxMetrics] = useState<AgentOutboxMetrics | null>(null);
  const [loadingOutbox, setLoadingOutbox] = useState(false);
  const [outboxError, setOutboxError] = useState<string | null>(null);
  const [deliveringOutbox, setDeliveringOutbox] = useState(false);

  function generateSecret() {
    const value =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setForm((prev) => ({ ...prev, sharedSecret: value }));
  }

  async function loadOutboxMetrics(agentId: string) {
    setLoadingOutbox(true);
    try {
      const res = await fetch(`/api/admin/agents/${agentId}/outbox`);
      if (!res.ok) {
        setOutboxMetrics(null);
        setOutboxError("Failed to load agent outbox metrics.");
        setLoadingOutbox(false);
        return;
      }
      const payload = (await res.json()) as AgentOutboxMetrics;
      setOutboxMetrics(payload);
      setOutboxError(null);
      setLoadingOutbox(false);
    } catch (error) {
      setOutboxMetrics(null);
      setOutboxError("Failed to load agent outbox metrics.");
      setLoadingOutbox(false);
    }
  }

  async function loadAgent() {
    const res = await fetch("/api/admin/agents");
    if (!res.ok) {
      return;
    }
    const payload = await res.json();
    const primary = payload.agents?.[0] ?? null;
    setAgent(primary);
    if (primary) {
      setForm({
        name: primary.name,
        baseUrl: primary.base_url,
        sharedSecret: primary.shared_secret,
        status: primary.status,
        policyMode: primary.policy_mode,
        maxEventsPerRun: parseMaxEventsPerRun(primary.capabilities),
        policyJson: JSON.stringify(primary.policy ?? {}, null, 2)
      });
    } else {
      setOutboxMetrics(null);
      setOutboxError(null);
    }
  }

  useEffect(() => {
    void loadAgent();
  }, []);

  useEffect(() => {
    if (!agent?.id) return;
    void loadOutboxMetrics(agent.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);

    let policy: Record<string, unknown> | undefined;
    if (form.policyJson.trim()) {
      try {
        policy = JSON.parse(form.policyJson);
      } catch (error) {
        setError("Policy JSON is invalid.");
        setLoading(false);
        return;
      }
    }

    const capabilities: Record<string, unknown> = {
      ...(agent?.capabilities ?? {})
    };
    if (form.maxEventsPerRun.trim()) {
      const parsedLimit = Number(form.maxEventsPerRun);
      if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
        setError("Max events per run must be a positive number.");
        setLoading(false);
        return;
      }
      capabilities.max_events_per_run = Math.min(Math.trunc(parsedLimit), 50);
    } else {
      delete capabilities.max_events_per_run;
    }

    const payload = {
      name: form.name,
      baseUrl: form.baseUrl,
      sharedSecret: form.sharedSecret,
      status: form.status,
      policyMode: form.policyMode,
      capabilities,
      policy
    };

    const res = await fetch(agent ? `/api/admin/agents/${agent.id}` : "/api/admin/agents", {
      method: agent ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to save agent integration");
      setLoading(false);
      return;
    }

    const body = await res.json();
    const nextAgent = (body.agent ?? agent) as AgentIntegration | null;
    setAgent(nextAgent);
    if (nextAgent) {
      void loadOutboxMetrics(nextAgent.id);
    }
    setSaved(true);
    setLoading(false);
  }

  async function deliverOutboxNow() {
    if (!agent) return;
    setDeliveringOutbox(true);
    setOutboxError(null);
    const res = await fetch(`/api/admin/agents/${agent.id}/outbox/deliver`, {
      method: "POST"
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setOutboxError(payload.error ?? "Failed to deliver queued events.");
      setDeliveringOutbox(false);
      return;
    }
    await loadOutboxMetrics(agent.id);
    setDeliveringOutbox(false);
  }

  const webhookUrl = form.baseUrl
    ? `${form.baseUrl.replace(/\/+$/, "")}/hooks/6esk/events`
    : "";

  return (
    <section style={{ marginTop: compact ? 0 : 40 }}>
      <h2 style={{ marginBottom: 12 }}>AI Agent Integration</h2>
      <p style={{ marginBottom: 12 }}>
        Connect your ElizaOS runtime. Default mode is draft-only with 24/7 working hours. Toggle
        auto-send if you want AI to send replies without approval.
      </p>
      <form onSubmit={handleSave} style={{ display: "grid", gap: 12 }}>
        <label>
          Agent name
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
        </label>
        <label>
          Base URL
          <input
            type="url"
            placeholder="https://venus-develop-production.up.railway.app"
            value={form.baseUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
            required
          />
        </label>
        <label>
          Shared secret
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={form.sharedSecret}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sharedSecret: event.target.value }))
              }
              required
            />
            <button
              type="button"
              onClick={generateSecret}
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
          </div>
        </label>
        <label>
          AI mode
          <select
            value={form.policyMode}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                policyMode: event.target.value as "draft_only" | "auto_send"
              }))
            }
          >
            <option value="draft_only">Draft only (recommended)</option>
            <option value="auto_send">Auto-send</option>
          </select>
        </label>
        <label>
          Max events per run (throughput cap)
          <input
            type="number"
            min={1}
            max={50}
            placeholder="5"
            value={form.maxEventsPerRun}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, maxEventsPerRun: event.target.value }))
            }
          />
        </label>
        <label>
          Policy JSON (working hours + escalation)
          <textarea
            rows={8}
            value={form.policyJson}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, policyJson: event.target.value }))
            }
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)" }}
          />
        </label>
        <label>
          Status
          <select
            value={form.status}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, status: event.target.value as "active" | "paused" }))
            }
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </label>
        {agent ? (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            Agent ID: <span style={{ color: "var(--text)" }}>{agent.id}</span>
          </p>
        ) : null}
        {webhookUrl ? (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            Webhook URL: <span style={{ color: "var(--text)" }}>{webhookUrl}</span>
          </p>
        ) : null}
        {agent ? (
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 12,
              background: "rgba(10, 12, 18, 0.6)",
              display: "grid",
              gap: 10
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong>Outbox Queue Controls</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => loadOutboxMetrics(agent.id)}
                  disabled={loadingOutbox}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text)",
                    cursor: "pointer"
                  }}
                >
                  {loadingOutbox ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={deliverOutboxNow}
                  disabled={deliveringOutbox || form.status !== "active"}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    cursor: "pointer"
                  }}
                >
                  {deliveringOutbox ? "Delivering..." : "Deliver now"}
                </button>
              </div>
            </div>
            {outboxMetrics ? (
              <>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Integration status: {outboxMetrics.integrationStatus} · Effective limit:{" "}
                  {outboxMetrics.throughput.effectiveLimit}
                  {outboxMetrics.throughput.configuredMaxEventsPerRun
                    ? ` (cap ${outboxMetrics.throughput.configuredMaxEventsPerRun})`
                    : " (default)"}
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))"
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>Pending</div>
                    <strong>{outboxMetrics.queue.pending}</strong>
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
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>Delivered (24h)</div>
                    <strong>{outboxMetrics.queue.delivered24h}</strong>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Next attempt:{" "}
                  {outboxMetrics.queue.nextAttemptAt
                    ? new Date(outboxMetrics.queue.nextAttemptAt).toLocaleString()
                    : "—"}
                  {" · "}
                  Last delivered:{" "}
                  {outboxMetrics.queue.lastDeliveredAt
                    ? new Date(outboxMetrics.queue.lastDeliveredAt).toLocaleString()
                    : "—"}
                </div>
                {outboxMetrics.queue.lastError ? (
                  <div style={{ fontSize: 12, color: "var(--danger)" }}>
                    Last error: {outboxMetrics.queue.lastError}
                  </div>
                ) : null}
              </>
            ) : null}
            {outboxError ? <p style={{ color: "var(--danger)", margin: 0 }}>{outboxError}</p> : null}
          </div>
        ) : null}
        {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
        {saved ? <p style={{ color: "var(--accent)" }}>Saved.</p> : null}
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
          {loading ? "Saving..." : "Save integration"}
        </button>
      </form>
    </section>
  );
}
