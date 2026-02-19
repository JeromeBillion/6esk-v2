"use client";

import { useState } from "react";
import BrandMark from "@/app/components/BrandMark";

export default function SupportFormClient() {
  const [form, setForm] = useState({ email: "", subject: "", description: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [revokeForm, setRevokeForm] = useState({ email: "", phone: "" });
  const [revokeStatus, setRevokeStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [revokeError, setRevokeError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setError(null);

    const res = await fetch("/api/portal/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: form.email,
        subject: form.subject,
        description: form.description
      })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? "Failed to submit ticket");
      setStatus("error");
      return;
    }

    setStatus("sent");
    setForm({ email: "", subject: "", description: "" });
  }

  async function handleRevokeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = revokeForm.email.trim();
    const phone = revokeForm.phone.trim();
    if (!email && !phone) {
      setRevokeError("Provide your email or callback phone number.");
      setRevokeStatus("error");
      return;
    }

    setRevokeStatus("sending");
    setRevokeError(null);
    const response = await fetch("/api/support/voice-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "revoke",
        email: email || null,
        phone: phone || null,
        source: "help_center_self_service"
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setRevokeError(payload.error ?? "Failed to update call consent");
      setRevokeStatus("error");
      return;
    }

    setRevokeStatus("sent");
    setRevokeForm({ email, phone: "" });
  }

  return (
    <main>
      <div className="container" style={{ maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <BrandMark size={44} />
          <div>
            <h1>Contact Support</h1>
            <p>Submit your question and our team will respond by email.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              required
            />
          </label>
          <label>
            Subject
            <input
              type="text"
              value={form.subject}
              onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
              required
            />
          </label>
          <label>
            Message
            <textarea
              rows={6}
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              required
            />
          </label>
          {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
          {status === "sent" ? (
            <p style={{ color: "var(--accent)" }}>Ticket submitted. We will reply soon.</p>
          ) : null}
          <button
            type="submit"
            disabled={status === "sending"}
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, var(--accent-strong), var(--accent))",
              color: "#081018",
              cursor: "pointer"
            }}
          >
            {status === "sending" ? "Submitting..." : "Submit ticket"}
          </button>
        </form>
        <section
          style={{
            marginTop: 22,
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 14,
            background: "rgba(10, 12, 18, 0.45)"
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>Stop voice callbacks</h2>
          <p style={{ marginTop: 8, color: "var(--muted)" }}>
            Revoke consent for outbound support calls. Future call attempts will be blocked.
          </p>
          <form onSubmit={handleRevokeSubmit} style={{ display: "grid", gap: 10 }}>
            <label>
              Email (optional)
              <input
                type="email"
                value={revokeForm.email}
                onChange={(event) =>
                  setRevokeForm((prev) => ({ ...prev, email: event.target.value }))
                }
                placeholder="you@example.com"
              />
            </label>
            <label>
              Callback phone (optional)
              <input
                type="tel"
                value={revokeForm.phone}
                onChange={(event) =>
                  setRevokeForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                placeholder="+15551234567"
              />
            </label>
            {revokeError ? <p style={{ color: "var(--danger)", margin: 0 }}>{revokeError}</p> : null}
            {revokeStatus === "sent" ? (
              <p style={{ color: "var(--accent)", margin: 0 }}>
                Voice callback consent revoked.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={revokeStatus === "sending"}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                cursor: "pointer"
              }}
            >
              {revokeStatus === "sending" ? "Updating..." : "Revoke call consent"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
