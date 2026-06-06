"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PublicPageFrame from "@/app/components/PublicPageFrame";
import { setStoredDemoMode } from "@/app/lib/demo-mode";
import { ActionFeedbackModal } from "@/app/workspace/components/ActionFeedbackModal";
import { Button } from "@/app/workspace/components/ui/button";
import { Input } from "@/app/workspace/components/ui/input";

type PublicAuthProvider = {
  id: string;
  label: string;
  flow: "social" | "generic_oauth";
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <PublicPageFrame
          title="Sign in"
          description="Use your 6esk account to enter the support workspace."
        >
          <div className="h-40 rounded-lg border border-neutral-200 bg-white" />
        </PublicPageFrame>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [federatedLoading, setFederatedLoading] = useState<string | null>(null);
  const [authProviders, setAuthProviders] = useState<PublicAuthProvider[]>([]);
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
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled && payload?.enabled && Array.isArray(payload.providers)) {
          setAuthProviders(payload.providers);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthProviders([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const challenge = searchParams.get("mfaChallenge");
    if (challenge) {
      setMfaChallengeToken(challenge);
    }
  }, [searchParams]);

  function nextPath() {
    const next = searchParams.get("next")?.trim();
    return next && next.startsWith("/") && !next.startsWith("//") ? next : "/tickets";
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setFeedback({
        open: true,
        tone: "error",
        title: "Sign in failed",
        message: payload.error ?? "Login failed"
      });
      setLoading(false);
      return;
    }

    if (payload.status === "mfa_required" && typeof payload.challengeToken === "string") {
      setMfaChallengeToken(payload.challengeToken);
      setMfaCode("");
      setFeedback({
        open: true,
        tone: "info",
        title: "MFA required",
        message: "Enter your authenticator code to finish signing in."
      });
      setLoading(false);
      return;
    }

    setStoredDemoMode(false);
    router.push(payload.mfaEnrollmentRequired ? "/admin?mfaEnrollment=required" : "/tickets");
  }

  async function handleMfaSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallengeToken) return;
    setLoading(true);

    const response = await fetch("/api/auth/mfa/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeToken: mfaChallengeToken, code: mfaCode })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFeedback({
        open: true,
        tone: "error",
        title: "MFA failed",
        message: payload.error ?? "Invalid MFA code"
      });
      setLoading(false);
      return;
    }

    setStoredDemoMode(false);
    router.push(nextPath());
  }

  async function handleFederatedSignIn(provider: PublicAuthProvider) {
    setFederatedLoading(provider.id);
    const response = await fetch(
      provider.flow === "generic_oauth"
        ? "/api/auth/better/sign-in/oauth2"
        : "/api/auth/better/sign-in/social",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          provider.flow === "generic_oauth"
            ? {
                providerId: provider.id,
                callbackURL: "/api/auth/better/bridge?next=/tickets",
                requestSignUp: true
              }
            : {
                provider: provider.id,
                callbackURL: "/api/auth/better/bridge?next=/tickets",
                requestSignUp: true
              }
        )
      }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.url) {
      setFeedback({
        open: true,
        tone: "error",
        title: "Sign in failed",
        message: payload.error ?? "Provider sign in failed"
      });
      setFederatedLoading(null);
      return;
    }

    window.location.assign(payload.url);
  }

  return (
    <PublicPageFrame
      title="Sign in"
      description="Use your 6esk account to enter the support workspace."
    >
      {mfaChallengeToken ? (
        <form onSubmit={handleMfaSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <label htmlFor="mfaCode">Authenticator code</label>
            <Input
              id="mfaCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,8}"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              required
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={() => setMfaChallengeToken(null)}>
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
      {!mfaChallengeToken && authProviders.length > 0 ? (
        <div className="mt-6 grid gap-3 border-t border-neutral-200 pt-6">
          {authProviders.map((provider) => (
            <Button
              key={provider.id}
              type="button"
              variant="outline"
              disabled={Boolean(federatedLoading)}
              onClick={() => void handleFederatedSignIn(provider)}
            >
              {federatedLoading === provider.id ? "Redirecting..." : `Continue with ${provider.label}`}
            </Button>
          ))}
        </div>
      ) : null}
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
