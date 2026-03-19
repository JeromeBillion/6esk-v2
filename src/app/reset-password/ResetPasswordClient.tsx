"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PublicPageFrame from "@/app/components/PublicPageFrame";
import { ActionFeedbackModal } from "@/app/workspace/components/ActionFeedbackModal";
import { Button } from "@/app/workspace/components/ui/button";
import { Input } from "@/app/workspace/components/ui/input";

export default function ResetPasswordClient({ token }: { token?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
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
    if (!token) {
      setFeedback({
        open: true,
        tone: "error",
        title: "Reset failed",
        message: "Missing reset token."
      });
      return;
    }
    if (password.length < 8) {
      setFeedback({
        open: true,
        tone: "error",
        title: "Password too short",
        message: "Password must be at least 8 characters."
      });
      return;
    }
    if (password !== confirm) {
      setFeedback({
        open: true,
        tone: "error",
        title: "Validation failed",
        message: "Passwords do not match."
      });
      return;
    }

    setStatus("saving");
    const res = await fetch("/api/auth/password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setFeedback({
        open: true,
        tone: "error",
        title: "Reset failed",
        message: payload.error ?? "Failed to reset password"
      });
      setStatus("error");
      return;
    }

    setStatus("done");
    setFeedback({
      open: true,
      tone: "success",
      title: "Password updated",
      message: "Your password was reset successfully. You can sign in now."
    });
  }

  return (
    <PublicPageFrame
      title="Reset password"
      description="Set a new password and return to the workspace."
      maxWidthClassName="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="grid gap-5">
        <div className="grid gap-2">
          <label htmlFor="password">New password</label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
          />
        </div>
        <div className="grid gap-2">
          <label htmlFor="confirm">Confirm password</label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            required
            minLength={8}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={status === "saving"}>
            {status === "saving" ? "Saving..." : "Update password"}
          </Button>
        </div>
      </form>
      <ActionFeedbackModal
        open={feedback.open}
        onClose={() => {
          const wasSuccess = feedback.tone === "success" && status === "done";
          setFeedback((previous) => ({
            ...previous,
            open: false
          }));
          if (wasSuccess) {
            router.push("/login");
          }
        }}
        tone={feedback.tone}
        title={feedback.title}
        message={feedback.message}
        autoCloseMs={feedback.autoCloseMs}
      />
    </PublicPageFrame>
  );
}
