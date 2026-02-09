"use client";

import { useEffect, useState } from "react";

type Tag = {
  id: string;
  name: string;
  description?: string | null;
};

export default function TagsClient() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: "", description: "" });
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [editingId, setEditingId] = useState<string | null>(null);

  async function loadTags() {
    const res = await fetch("/api/support/tags");
    if (!res.ok) return;
    const payload = await res.json();
    setTags(payload.tags ?? []);
  }

  useEffect(() => {
    void loadTags();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    const res = await fetch(
      editingId ? `/api/support/tags/${editingId}` : "/api/support/tags",
      {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      }
    );

    if (!res.ok) {
      setStatus("error");
      return;
    }

    setForm({ name: "", description: "" });
    setEditingId(null);
    setStatus("idle");
    await loadTags();
  }

  function startEdit(tag: Tag) {
    setForm({ name: tag.name, description: tag.description ?? "" });
    setEditingId(tag.id);
  }

  function cancelEdit() {
    setForm({ name: "", description: "" });
    setEditingId(null);
  }

  async function deleteTag(tagId: string) {
    const res = await fetch(`/api/support/tags/${tagId}`, { method: "DELETE" });
    if (res.ok) {
      await loadTags();
    }
  }

  return (
    <section style={{ marginTop: 40 }}>
      <h2 style={{ marginBottom: 12 }}>Tags</h2>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <label>
          Tag name
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
        </label>
        <label>
          Description
          <input
            type="text"
            value={form.description}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, description: event.target.value }))
            }
          />
        </label>
        {status === "error" ? (
          <p style={{ color: "var(--danger)" }}>Failed to save tag.</p>
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
          {status === "saving"
            ? "Saving..."
            : editingId
              ? "Update tag"
              : "Add tag"}
        </button>
        {editingId ? (
          <button
            type="button"
            onClick={cancelEdit}
            style={{
              padding: "12px 16px",
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
      </form>

      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        {tags.map((tag) => (
          <div
            key={tag.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 10,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <strong>{tag.name}</strong>
            {tag.description ? <p>{tag.description}</p> : null}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => startEdit(tag)}
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
                onClick={() => deleteTag(tag.id)}
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
