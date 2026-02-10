"use client";

import { useEffect, useState } from "react";

type AgentIntegration = {
  id: string;
  name: string;
  base_url: string;
  shared_secret: string;
  status: "active" | "paused";
  policy_mode: "draft_only" | "auto_send";
  policy?: Record<string, unknown>;
};

type AgentIntegrationClientProps = {
  compact?: boolean;
};

export default function AgentIntegrationClient({ compact = false }: AgentIntegrationClientProps) {
  const [agent, setAgent] = useState<AgentIntegration | null>(null);
  const [form, setForm] = useState({
    name: "6esk AI Agent",
    baseUrl: "",
    sharedSecret: "",
    status: "active" as "active" | "paused",
    policyMode: "draft_only" as "draft_only" | "auto_send",
    policyJson: "{\n  \"working_hours\": {\n    \"timezone\": \"Africa/Johannesburg\",\n    \"days\": [1,2,3,4,5],\n    \"start\": \"08:00\",\n    \"end\": \"18:00\"\n  },\n  \"escalation\": {\n    \"out_of_hours\": \"draft_only\",\n    \"tag\": \"urgent\"\n  }\n}"
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function generateSecret() {
    const value =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setForm((prev) => ({ ...prev, sharedSecret: value }));
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
        policyJson: JSON.stringify(primary.policy ?? {}, null, 2)
      });
    }
  }

  useEffect(() => {
    void loadAgent();
  }, []);

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

    const payload = {
      name: form.name,
      baseUrl: form.baseUrl,
      sharedSecret: form.sharedSecret,
      status: form.status,
      policyMode: form.policyMode,
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
    setAgent(body.agent ?? agent);
    setSaved(true);
    setLoading(false);
  }

  const webhookUrl = form.baseUrl
    ? `${form.baseUrl.replace(/\/+$/, "")}/hooks/6esk/events`
    : "";

  return (
    <section style={{ marginTop: compact ? 0 : 40 }}>
      <h2 style={{ marginBottom: 12 }}>AI Agent Integration</h2>
      <p style={{ marginBottom: 12 }}>
        Connect your ElizaOS runtime. Default mode is draft-only. Toggle auto-send if you want
        AI to send replies without approval.
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
