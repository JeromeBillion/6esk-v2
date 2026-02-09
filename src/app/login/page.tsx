"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Login failed");
      setLoading(false);
      return;
    }

    router.push("/mail");
  }

  return (
    <main>
      <div className="container">
        <h1>Sign in to 6esk</h1>
        <p>Lead Admin creates accounts in the admin panel.</p>
        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                style={{ width: "100%", padding: 10, marginTop: 6 }}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                style={{ width: "100%", padding: 10, marginTop: 6 }}
              />
            </label>
            {error ? <p style={{ color: "#c0392b" }}>{error}</p> : null}
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                border: "none",
                background: "#1a1a1a",
                color: "#fff",
                cursor: "pointer"
              }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
