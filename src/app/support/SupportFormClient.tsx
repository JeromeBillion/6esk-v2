"use client";

import { useState } from "react";
import PublicPageFrame from "@/app/components/PublicPageFrame";
import { ActionFeedbackModal } from "@/app/workspace/components/ActionFeedbackModal";
import { Button } from "@/app/workspace/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/workspace/components/ui/card";
import { Input } from "@/app/workspace/components/ui/input";
import { Textarea } from "@/app/workspace/components/ui/textarea";

export default function SupportFormClient() {
  const [form, setForm] = useState({ email: "", subject: "", description: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [revokeForm, setRevokeForm] = useState({ email: "", phone: "" });
  const [revokeStatus, setRevokeStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
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
    setStatus("sending");

    const res = await fetch("/api/portal/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: form.email,
        subject: form.subject,
        description: form.description
      })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setFeedback({
        open: true,
        tone: "error",
        title: "Ticket submission failed",
        message: payload.error ?? "Failed to submit ticket"
      });
      setStatus("error");
      return;
    }

    setStatus("sent");
    setForm({ email: "", subject: "", description: "" });
    setFeedback({
      open: true,
      tone: "success",
      title: "Ticket submitted",
      message: "Your support request was received. We will reply soon.",
      autoCloseMs: 1500
    });
  }

  async function handleRevokeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = revokeForm.email.trim();
    const phone = revokeForm.phone.trim();
    if (!email && !phone) {
      setFeedback({
        open: true,
        tone: "error",
        title: "Missing identity",
        message: "Provide your email or callback phone number."
      });
      setRevokeStatus("error");
      return;
    }

    setRevokeStatus("sending");
    const response = await fetch("/api/support/voice-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "revoke",
        email: email || null,
        phone: phone || null,
        source: "help_center_self_service"
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setFeedback({
        open: true,
        tone: "error",
        title: "Consent update failed",
        message: payload.error ?? "Failed to update call consent"
      });
      setRevokeStatus("error");
      return;
    }

    setRevokeStatus("sent");
    setRevokeForm({ email, phone: "" });
    setFeedback({
      open: true,
      tone: "success",
      title: "Voice consent revoked",
      message: "Future outbound support call attempts will be blocked.",
      autoCloseMs: 1500
    });
  }

  return (
    <PublicPageFrame
      title="Contact support"
      description="Submit your issue and manage outbound voice-call consent from one place."
      maxWidthClassName="max-w-3xl"
    >
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Submit a ticket</CardTitle>
            <CardDescription>Our team will reply by email as soon as possible.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <label htmlFor="support-email">Email</label>
                <Input
                  id="support-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="support-subject">Subject</label>
                <Input
                  id="support-subject"
                  type="text"
                  value={form.subject}
                  onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="support-message">Message</label>
                <Textarea
                  id="support-message"
                  rows={8}
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={status === "sending"}>
                  {status === "sending" ? "Submitting..." : "Submit ticket"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Stop voice callbacks</CardTitle>
            <CardDescription>
              Revoke consent for outbound support calls. Future attempts will be blocked.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRevokeSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <label htmlFor="revoke-email">Email</label>
                <Input
                  id="revoke-email"
                  type="email"
                  value={revokeForm.email}
                  onChange={(event) => setRevokeForm((prev) => ({ ...prev, email: event.target.value }))}
                  placeholder="you@example.com"
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="revoke-phone">Callback phone</label>
                <Input
                  id="revoke-phone"
                  type="tel"
                  value={revokeForm.phone}
                  onChange={(event) => setRevokeForm((prev) => ({ ...prev, phone: event.target.value }))}
                  placeholder="+15551234567"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="outline" disabled={revokeStatus === "sending"}>
                  {revokeStatus === "sending" ? "Updating..." : "Revoke call consent"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

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
