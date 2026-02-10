"use client";

import { useEffect, useState } from "react";

type SpamRule = {
  id: string;
  rule_type: "allow" | "block";
  scope: "sender" | "domain" | "subject" | "body";
  pattern: string;
  is_active: boolean;
  created_at: string;
};

type SpamRulesClientProps = {
  compact?: boolean;
};

export default function SpamRulesClient({ compact = false }: SpamRulesClientProps) {
  const [rules, setRules] = useState<SpamRule[]>([]);
  const [form, setForm] = useState({
    ruleType: "block" as "allow" | "block",
    scope: "sender" as "sender" | "domain" | "subject" | "body",
    pattern: ""
  });
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function loadRules() {
    const res = await fetch("/api/admin/spam-rules");
    if (!res.ok) return;
    const payload = await res.json();
    setRules(payload.rules ?? []);
  }

  useEffect(() => {
    void loadRules();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    const res = await fetch("/api/admin/spam-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!res.ok) {
      setStatus("error");
      return;
    }
    setForm((prev) => ({ ...prev, pattern: "" }));
    setStatus("idle");
    await loadRules();
  }

  async function toggleRule(rule: SpamRule) {
    await fetch(`/api/admin/spam-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !rule.is_active })
    });
    await loadRules();
  }

  async function deleteRule(ruleId: string) {
    await fetch(`/api/admin/spam-rules/${ruleId}`, { method: "DELETE" });
    await loadRules();
  }

  return (
    <section style={{ marginTop: compact ? 0 : 40 }}>
      <h2 style={{ marginBottom: 12 }}>Spam Rules</h2>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <label>
          Rule type
          <select
            value={form.ruleType}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, ruleType: event.target.value as "allow" | "block" }))
            }
          >
            <option value="block">Blocklist</option>
            <option value="allow">Allowlist</option>
          </select>
        </label>
        <label>
          Scope
          <select
            value={form.scope}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                scope: event.target.value as "sender" | "domain" | "subject" | "body"
              }))
            }
          >
            <option value="sender">Sender (email)</option>
            <option value="domain">Domain</option>
            <option value="subject">Subject contains</option>
            <option value="body">Body contains</option>
          </select>
        </label>
        <label>
          Pattern
          <input
            type="text"
            value={form.pattern}
            onChange={(event) => setForm((prev) => ({ ...prev, pattern: event.target.value }))}
            placeholder="spam@example.com"
            required
          />
        </label>
        {status === "error" ? (
          <p style={{ color: "var(--danger)" }}>Failed to save rule.</p>
        ) : null}
        <button
          type="submit"
          disabled={status === "saving"}
          style={{
            padding: "12px 16px",
            borderRadius: 10,
            border: "none",
            background: "linear-gradient(135deg, var(--accent-strong), var(--accent))",
            color: "#081018",
            cursor: "pointer"
          }}
        >
          {status === "saving" ? "Saving..." : "Add rule"}
        </button>
      </form>

      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        {rules.map((rule) => (
          <div
            key={rule.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 10,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <strong>
              {rule.rule_type.toUpperCase()} · {rule.scope}
            </strong>
            <p>{rule.pattern}</p>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => toggleRule(rule)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  cursor: "pointer"
                }}
              >
                {rule.is_active ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                onClick={() => deleteRule(rule.id)}
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
        ))}
      </div>
    </section>
  );
}
