"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PublicPageFrame from "@/app/components/PublicPageFrame";
import { setStoredDemoMode } from "@/app/lib/demo-mode";
import { ActionFeedbackModal } from "@/app/workspace/components/ActionFeedbackModal";
import { Button } from "@/app/workspace/components/ui/button";
import { Input } from "@/app/workspace/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaChallengeFromCookie, setMfaChallengeFromCookie] = useState(false);
  const [returnTo, setReturnTo] = useState("/tickets");
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const challengeToken = params.get("challengeToken");
    const mfaRequired = params.get("mfa") === "required";
    const nextReturnTo = params.get("returnTo");
    if (nextReturnTo?.startsWith("/") && !nextReturnTo.startsWith("//")) {
      setReturnTo(nextReturnTo);
    }
    if (mfaRequired) {
      setMfaChallengeToken(challengeToken);
      setMfaChallengeFromCookie(!challengeToken);
      setFeedback({
        open: true,
        tone: "info",
        title: "Verification required",
        message: "Enter your authenticator code to finish signing in."
      });
      window.history.replaceState(null, "", "/login");
    }

    const error = params.get("error");
    if (error) {
      setFeedback({
        open: true,
        tone: "error",
        title: "Sign in failed",
        message: oauthErrorMessage(error)
      });
      window.history.replaceState(null, "", "/login");
    }
  }, []);

  function startOAuth(provider: "google" | "microsoft") {
    const params = new URLSearchParams({
      provider,
      returnTo
    });
    window.location.href = `/api/auth/oauth/authorize?${params.toString()}`;
  }

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

    const payload = await response.json().catch(() => ({}));
    if (payload.status === "mfa_required" && payload.challengeToken) {
      setMfaChallengeToken(payload.challengeToken);
      setMfaChallengeFromCookie(false);
      setMfaCode("");
      setFeedback({
        open: true,
        tone: "info",
        title: "Verification required",
        message: "Enter your authenticator code to finish signing in."
      });
      setLoading(false);
      return;
    }

    setStoredDemoMode(false);
    router.push(returnTo);
  }

  async function handleMfaSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallengeToken && !mfaChallengeFromCookie) return;
    setLoading(true);

    const body: { code: string; challengeToken?: string } = { code: mfaCode };
    if (mfaChallengeToken) {
      body.challengeToken = mfaChallengeToken;
    }

    const response = await fetch("/api/auth/mfa/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setFeedback({
        open: true,
        tone: "error",
        title: "Verification failed",
        message: payload.error ?? "Enter a current authenticator code."
      });
      setLoading(false);
      return;
    }

    setStoredDemoMode(false);
    router.push(returnTo);
  }

  const mfaChallengeActive = Boolean(mfaChallengeToken || mfaChallengeFromCookie);

  return (
    <PublicPageFrame
      title="Sign in"
      description="Use your 6esk account to enter the support workspace."
    >
      <div className="grid gap-3">
        <Button type="button" variant="outline" onClick={() => startOAuth("google")}>
          Continue with Google
        </Button>
        <Button type="button" variant="outline" onClick={() => startOAuth("microsoft")}>
          Continue with Microsoft
        </Button>
      </div>
      <div className="relative my-2 flex items-center gap-3 text-xs text-neutral-400">
        <span className="h-px flex-1 bg-neutral-200" />
        <span>or</span>
        <span className="h-px flex-1 bg-neutral-200" />
      </div>
      {mfaChallengeActive ? (
        <form onSubmit={handleMfaSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <label htmlFor="mfa-code">Authenticator code</label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              required
              minLength={6}
              maxLength={12}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMfaChallengeToken(null);
                setMfaChallengeFromCookie(false);
              }}
            >
              Back
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Verifying..." : "Verify"}
            </Button>
          </div>
        </form>
      ) : (
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
      )}
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

function oauthErrorMessage(error: string) {
  switch (error) {
    case "oauth_provider_denied":
      return "The provider did not authorize the sign in.";
    case "oauth_exchange_failed":
      return "The provider could not complete this sign in.";
    case "oauth_unverified_email":
      return "The provider email is not verified.";
    case "oauth_invalid_account":
      return "This provider account is not linked to an active 6esk user.";
    default:
      return "The sign in request could not be verified.";
  }
}
