"use client";

import { useState } from "react";
import BrandMark from "@/app/components/BrandMark";

export default function SupportFormClient() {
  const [form, setForm] = useState({ email: "", subject: "", description: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

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
      </div>
    </main>
  );
}
