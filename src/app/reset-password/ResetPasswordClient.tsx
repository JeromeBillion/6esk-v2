"use client";

import { useState } from "react";
import BrandMark from "@/app/components/BrandMark";

export default function ResetPasswordClient({ token }: { token?: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("Missing reset token.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setStatus("saving");
    setError(null);
    const res = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? "Failed to reset password");
      setStatus("error");
      return;
    }

    setStatus("done");
  }

  return (
    <main>
      <div className="container" style={{ maxWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <BrandMark size={44} />
          <div>
            <h1>Reset Password</h1>
            <p>Enter a new password for your account.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
              minLength={8}
            />
          </label>
          {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
          {status === "done" ? (
            <p style={{ color: "var(--accent)" }}>Password updated. You can sign in now.</p>
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
            {status === "saving" ? "Saving..." : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
