"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import PublicPageFrame from "@/app/components/PublicPageFrame";
import { ActionFeedbackModal } from "@/app/workspace/components/ActionFeedbackModal";
import { Button } from "@/app/workspace/components/ui/button";
import { Input } from "@/app/workspace/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    open: boolean;
    tone: "success" | "error" | "info";
    title: string;
    message: string;
    autoCloseMs?: number;
  }>({
    open: false,
    tone: "info",
    title: "",
    message: ""
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setFeedback({
        open: true,
        tone: "error",
        title: "Sign in failed",
        message: payload.error ?? "Login failed"
      });
      setLoading(false);
      return;
    }

    router.push("/tickets");
  }

  return (
    <PublicPageFrame
      title="Sign in"
      description="Use your 6esk account to enter the support workspace."
    >
      <form onSubmit={handleSubmit} className="grid gap-5">
        <div className="grid gap-2">
          <label htmlFor="email">Email</label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="grid gap-2">
          <label htmlFor="password">Password</label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">Lead Admin accounts are provisioned from the admin workspace.</p>
          <Button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </div>
      </form>
      <ActionFeedbackModal
        open={feedback.open}
        onClose={() =>
          setFeedback((previous) => ({
            ...previous,
            open: false
          }))
        }
        tone={feedback.tone}
        title={feedback.title}
        message={feedback.message}
        autoCloseMs={feedback.autoCloseMs}
      />
    </PublicPageFrame>
  );
}
