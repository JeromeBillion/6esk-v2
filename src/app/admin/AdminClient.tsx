"use client";

import { useEffect, useState } from "react";
import TagsClient from "./TagsClient";

type Role = {
  id: string;
  name: string;
  description?: string | null;
};

type User = {
  id: string;
  email: string;
  display_name: string;
  role_name?: string | null;
  is_active: boolean;
  created_at: string;
};

type SlaConfig = {
  firstResponseMinutes: number;
  resolutionMinutes: number;
};

export default function AdminClient() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sla, setSla] = useState<SlaConfig>({
    firstResponseMinutes: 120,
    resolutionMinutes: 1440
  });
  const [slaStatus, setSlaStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [form, setForm] = useState({
    email: "",
    displayName: "",
    password: "",
    roleId: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function loadData() {
    const [rolesRes, usersRes, slaRes] = await Promise.all([
      fetch("/api/admin/roles"),
      fetch("/api/admin/users"),
      fetch("/api/admin/sla")
    ]);

    if (rolesRes.ok) {
      const payload = await rolesRes.json();
      setRoles(payload.roles ?? []);
      if (!form.roleId && payload.roles?.[0]) {
        setForm((prev) => ({ ...prev, roleId: payload.roles[0].id }));
      }
    }

    if (usersRes.ok) {
      const payload = await usersRes.json();
      setUsers(payload.users ?? []);
    }

    if (slaRes.ok) {
      const payload = await slaRes.json();
      setSla({
        firstResponseMinutes: payload.firstResponseMinutes ?? 120,
        resolutionMinutes: payload.resolutionMinutes ?? 1440
      });
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Failed to create user");
      setLoading(false);
      return;
    }

    setForm((prev) => ({ ...prev, email: "", displayName: "", password: "" }));
    await loadData();
    setLoading(false);
  }

  return (
    <main>
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1>Lead Admin Panel</h1>
            <p>Create users, assign roles, and provision mailboxes.</p>
          </div>
          <button
            type="button"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface-2)",
              color: "var(--text)",
              cursor: "pointer",
              height: 40
            }}
          >
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>

        <section style={{ marginTop: 32 }}>
          <h2 style={{ marginBottom: 12 }}>Create User</h2>
          <form onSubmit={handleCreate} style={{ display: "grid", gap: 12 }}>
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, email: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Display name
              <input
                type="text"
                value={form.displayName}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, displayName: event.target.value }))
                }
                required
              />
            </label>
            <label>
              Temporary password
              <input
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, password: event.target.value }))
                }
                required
                minLength={8}
              />
            </label>
            <label>
              Role
              <select
                value={form.roleId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, roleId: event.target.value }))
                }
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
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
              {loading ? "Creating..." : "Create user"}
            </button>
          </form>
        </section>

        <section style={{ marginTop: 40 }}>
          <h2 style={{ marginBottom: 12 }}>SLA Targets</h2>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setSlaStatus("saving");
              const res = await fetch("/api/admin/sla", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(sla)
              });
              if (!res.ok) {
                setSlaStatus("error");
                return;
              }
              setSlaStatus("saved");
              setTimeout(() => setSlaStatus("idle"), 2000);
            }}
            style={{ display: "grid", gap: 12 }}
          >
            <label>
              First response target (minutes)
              <input
                type="number"
                min={1}
                value={sla.firstResponseMinutes}
                onChange={(event) =>
                  setSla((prev) => ({
                    ...prev,
                    firstResponseMinutes: Number(event.target.value)
                  }))
                }
              />
            </label>
            <label>
              Resolution target (minutes)
              <input
                type="number"
                min={1}
                value={sla.resolutionMinutes}
                onChange={(event) =>
                  setSla((prev) => ({
                    ...prev,
                    resolutionMinutes: Number(event.target.value)
                  }))
                }
              />
            </label>
            {slaStatus === "error" ? (
              <p style={{ color: "var(--danger)" }}>Failed to save SLA targets.</p>
            ) : null}
            {slaStatus === "saved" ? (
              <p style={{ color: "var(--accent)" }}>SLA targets updated.</p>
            ) : null}
            <button
              type="submit"
              disabled={slaStatus === "saving"}
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg, var(--accent-strong), var(--accent))",
                color: "#081018",
                cursor: "pointer"
              }}
            >
              {slaStatus === "saving" ? "Saving..." : "Save SLA targets"}
            </button>
          </form>
        </section>

        <TagsClient />

        <section style={{ marginTop: 40 }}>
          <h2 style={{ marginBottom: 12 }}>Users</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {users.map((user) => (
              <div
                key={user.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 12,
                  background: "rgba(10, 12, 18, 0.6)"
                }}
              >
                <strong>{user.display_name}</strong>
                <p>{user.email}</p>
                <p>Role: {user.role_name ?? "unassigned"}</p>
                <p>Status: {user.is_active ? "Active" : "Inactive"}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
