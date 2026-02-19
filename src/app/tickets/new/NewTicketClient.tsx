"use client";

import { useState } from "react";
import AppShell from "@/app/components/AppShell";

const CATEGORY_OPTIONS = ["payments", "markets", "account", "kyc", "security", "general"];

export default function NewTicketClient() {
  const [form, setForm] = useState({
    contactMode: "email" as "email" | "call",
    to: "",
    toPhone: "",
    subject: "",
    description: "",
    category: "general",
    tags: ""
  });
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    const payload = {
      contactMode: form.contactMode,
      to: form.to,
      toPhone: form.toPhone,
      subject: form.subject,
      description: form.description || null,
      category: form.category,
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    };

    const res = await fetch("/api/tickets/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to create ticket");
      setStatus("error");
      return;
    }

    setStatus("success");
    setForm((prev) => ({
      ...prev,
      to: "",
      toPhone: "",
      subject: "",
      description: "",
      tags: ""
    }));
  }

  return (
    <AppShell title="Create Ticket" subtitle="Create ticket via email or outbound call.">
      <div className="app-content">
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
          <label>
            Contact mode
            <select
              value={form.contactMode}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  contactMode: event.target.value === "call" ? "call" : "email"
                }))
              }
            >
              <option value="email">Email</option>
              <option value="call">Call</option>
            </select>
          </label>
          {form.contactMode === "email" ? (
          <label>
            Email to
            <input
              type="email"
              required
              value={form.to}
              onChange={(event) => setForm((prev) => ({ ...prev, to: event.target.value }))}
            />
          </label>
          ) : (
            <label>
              Phone number
              <input
                type="tel"
                required
                placeholder="+15551234567"
                value={form.toPhone}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, toPhone: event.target.value }))
                }
              />
            </label>
          )}
          <label>
            Subject
            <input
              type="text"
              required
              value={form.subject}
              onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
            />
          </label>
          <label>
            Category
            <select
              value={form.category}
              onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
            >
              {CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tags (comma separated)
            <input
              type="text"
              value={form.tags}
              onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
            />
          </label>
          <label>
            {form.contactMode === "call" ? "Call reason (optional)" : "Description"}
            <textarea
              rows={6}
              required={form.contactMode === "email"}
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </label>
          {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
          {status === "success" ? (
            <p style={{ color: "var(--accent)" }}>
              {form.contactMode === "call"
                ? "Ticket created and call queued."
                : "Ticket created and email sent."}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={status === "submitting"}
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, var(--accent-strong), var(--accent))",
              color: "#081018",
              cursor: "pointer"
            }}
          >
            {status === "submitting"
              ? "Creating..."
              : form.contactMode === "call"
                ? "Create ticket and queue call"
                : "Create ticket and send email"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
