"use client";

import { useState } from "react";
import BrandMark from "@/app/components/BrandMark";

const CATEGORY_OPTIONS = ["payments", "markets", "account", "kyc", "security", "general"];

export default function NewTicketClient() {
  const [form, setForm] = useState({
    from: "",
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
      from: form.from,
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
    setForm((prev) => ({ ...prev, subject: "", description: "", tags: "" }));
  }

  return (
    <main>
      <div className="container">
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <BrandMark size={40} />
          <div>
            <h1>Create Ticket</h1>
            <p>Use this form to log a support request manually.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16, marginTop: 24 }}>
          <label>
            From (requester email)
            <input
              type="email"
              required
              value={form.from}
              onChange={(event) => setForm((prev) => ({ ...prev, from: event.target.value }))}
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
            <p style={{ color: "var(--accent)" }}>Ticket created successfully.</p>
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
            {status === "submitting" ? "Creating..." : "Create ticket"}
          </button>
        </form>
      </div>
    </main>
  );
}
