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

    void load();
  }, []);

  function generateVerifyToken() {
    const token =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setForm((prev) => ({ ...prev, verifyToken: token }));
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

  const webhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp/inbound` : "";

  return (
    <section style={{ marginTop: compact ? 0 : 40 }}>
      <h2 style={{ marginBottom: 12 }}>WhatsApp Business</h2>
      <p style={{ marginBottom: 12 }}>
        Connect your WhatsApp Business account. Webhook verification must be configured in Meta.
      </p>
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
          Phone number
          <input
            type="text"
            value={form.phoneNumber}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, phoneNumber: event.target.value }))
            }
            required
          />
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
          <input
            type="password"
            value={form.accessToken}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, accessToken: event.target.value }))
            }
          />
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
          {loading ? "Saving..." : "Save WhatsApp settings"}
        </button>
      </form>
    </section>
  );
}
