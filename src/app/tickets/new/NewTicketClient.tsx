"use client";

import { useState } from "react";
import AppShell from "@/app/components/AppShell";

const CATEGORY_OPTIONS = ["payments", "markets", "account", "kyc", "security", "general"];

export default function NewTicketClient() {
  const [form, setForm] = useState({
    to: "",
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
      to: form.to,
      subject: form.subject,
      description: form.description,
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
    setForm((prev) => ({ ...prev, to: "", subject: "", description: "", tags: "" }));
  }

  return (
    <AppShell title="Create Ticket" subtitle="Create ticket and send email.">
      <div className="app-content">
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
          <label>
            Email to
            <input
              type="email"
              required
              value={form.to}
              onChange={(event) => setForm((prev) => ({ ...prev, to: event.target.value }))}
            />
          </label>
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
            Description
            <textarea
              rows={6}
              required
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </label>
          {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
          {status === "success" ? (
            <p style={{ color: "var(--accent)" }}>Ticket created and email sent.</p>
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
            {status === "submitting" ? "Creating..." : "Create ticket and send email"}
          </button>
        </form>
      </div>
    </AppShell>
  );
}
