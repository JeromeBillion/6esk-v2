"use client";

import Link from "next/link";
import { Upload, X } from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import AppShell from "@/app/components/AppShell";
import { listTags, type TagRecord } from "@/app/lib/api/admin";
import { createTicket } from "@/app/lib/api/tickets";
import { encodeAttachments, formatFileSize, type EncodedAttachment } from "@/app/lib/files";
import { ActionFeedbackModal } from "@/app/workspace/components/ActionFeedbackModal";
import { Badge } from "@/app/workspace/components/ui/badge";
import { Button } from "@/app/workspace/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/workspace/components/ui/card";
import { Input } from "@/app/workspace/components/ui/input";
import { Textarea } from "@/app/workspace/components/ui/textarea";

const CATEGORY_OPTIONS = ["payments", "markets", "account", "kyc", "security", "general"];

export default function NewTicketClient() {
  const [availableTags, setAvailableTags] = useState<TagRecord[]>([]);
  const [form, setForm] = useState({
    contactMode: "email" as "email" | "call",
    to: "",
    toPhone: "",
    subject: "",
    description: "",
    category: "general",
    tags: ""
  });
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [metadataInput, setMetadataInput] = useState("{}");
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<EncodedAttachment[]>([]);
  const [createdTicketId, setCreatedTicketId] = useState<string | null>(null);
  const [createdChannel, setCreatedChannel] = useState<"email" | "voice">("email");
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
    const controller = new AbortController();
    void listTags(controller.signal)
      .then((rows) => setAvailableTags(rows))
      .catch(() => setAvailableTags([]));
    return () => controller.abort();
  }, []);

  const parsedTagList = useMemo(
    () =>
      form.tags
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    [form.tags]
  );

  const tagSuggestions = useMemo(() => {
    const existing = new Set(parsedTagList);
    return availableTags
      .filter((tag) => !existing.has(tag.name.toLowerCase()))
      .slice(0, 8);
  }, [availableTags, parsedTagList]);

  function addTag(name: string) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return;
    if (parsedTagList.includes(normalized)) return;
    const next = [...parsedTagList, normalized];
    setForm((prev) => ({ ...prev, tags: next.join(", ") }));
  }

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    try {
      const encoded = await encodeAttachments(files);
      setAttachments((previous) => [...previous, ...encoded]);
    } catch {
      setFeedback({
        open: true,
        tone: "error",
        title: "Attachment error",
        message: "Failed to read one or more attachments."
      });
    } finally {
      event.target.value = "";
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMetadataError(null);
    setCreatedTicketId(null);

    let metadata: Record<string, unknown> | null = null;
    if (metadataInput.trim()) {
      try {
        const parsed = JSON.parse(metadataInput);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setMetadataError("Metadata must be a JSON object.");
          setStatus("idle");
          return;
        }
        metadata = parsed as Record<string, unknown>;
      } catch {
        setMetadataError("Metadata JSON is invalid.");
        setStatus("idle");
        return;
      }
    }

    const payload = {
      contactMode: form.contactMode,
      to: form.to,
      toPhone: form.toPhone,
      subject: form.subject,
      description: form.description || null,
      category: form.category,
      tags: parsedTagList,
      metadata,
      attachments:
        form.contactMode === "email"
          ? attachments.map((attachment) => ({
              filename: attachment.filename,
              contentType: attachment.contentType,
              contentBase64: attachment.contentBase64
            }))
          : undefined
    };

    try {
      const response = await createTicket(payload);
      const nextCreatedChannel =
        response.channel === "voice" || form.contactMode === "call" ? "voice" : "email";
      setCreatedTicketId(typeof response.ticketId === "string" ? response.ticketId : null);
      setCreatedChannel(nextCreatedChannel);
      setStatus("idle");
      setForm((prev) => ({
        ...prev,
        to: "",
        toPhone: "",
        subject: "",
        description: "",
        tags: ""
      }));
      setAttachments([]);
      setFeedback({
        open: true,
        tone: "success",
        title:
          nextCreatedChannel === "voice"
            ? "Ticket created and call queued"
            : "Ticket created and email sent",
        message: "The ticket is now available in Support.",
        autoCloseMs: 1500
      });
    } catch (error) {
      setStatus("idle");
      setFeedback({
        open: true,
        tone: "error",
        title: "Ticket creation failed",
        message: error instanceof Error ? error.message : "Failed to create ticket"
      });
      return;
    }
  }

  return (
    <AppShell>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="mb-1 text-2xl font-semibold">Create Ticket</h1>
              <p className="text-sm text-neutral-600">
                Start an email-based support ticket or queue an outbound call from the same form.
              </p>
            </div>
            <Card className="min-w-56">
              <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm">
                <div>
                  <p className="text-xs text-neutral-500">Mode</p>
                  <p className="font-semibold text-neutral-900">{form.contactMode === "call" ? "Voice" : "Email"}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Category</p>
                  <p className="font-semibold text-neutral-900">{form.category}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Tags</p>
                  <p className="font-semibold text-neutral-900">{parsedTagList.length}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Attachments</p>
                  <p className="font-semibold text-neutral-900">{attachments.length}</p>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Ticket Details</CardTitle>
              <CardDescription>
                Capture the contact destination, issue summary, and routing context up front.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="grid gap-4">
                  <label className="grid gap-2">
                    Contact mode
                    <select
                      value={form.contactMode}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          contactMode: event.target.value === "call" ? "call" : "email",
                        }))
                      }
                      className="h-11 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                    >
                      <option value="email">Email</option>
                      <option value="call">Call</option>
                    </select>
                  </label>

                  {form.contactMode === "email" ? (
                    <label className="grid gap-2">
                      Email to
                      <Input
                        type="email"
                        required
                        value={form.to}
                        onChange={(event) => setForm((prev) => ({ ...prev, to: event.target.value }))}
                      />
                    </label>
                  ) : (
                    <label className="grid gap-2">
                      Phone number
                      <Input
                        type="tel"
                        required
                        placeholder="+15551234567"
                        value={form.toPhone}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, toPhone: event.target.value }))
                        }
                      />
                    </label>
                  )}

                  <label className="grid gap-2">
                    Subject
                    <Input
                      type="text"
                      required
                      value={form.subject}
                      onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
                    />
                  </label>
                </div>

                <div className="grid gap-4">
                  <label className="grid gap-2">
                    Category
                    <select
                      value={form.category}
                      onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                      className="h-11 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                    >
                      {CATEGORY_OPTIONS.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-2">
                    Tags
                    <Input
                      type="text"
                      value={form.tags}
                      placeholder="payments, urgent, vip"
                      onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
                    />
                  </label>
                  {tagSuggestions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {tagSuggestions.map((tag) => (
                        <Button
                          key={tag.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => addTag(tag.name)}
                        >
                          {tag.name}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-2 lg:col-span-2">
                  <label>
                    {form.contactMode === "call" ? "Call reason" : "Description"}
                  </label>
                  <Textarea
                    rows={7}
                    required={form.contactMode === "email"}
                    value={form.description}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, description: event.target.value }))
                    }
                  />
                </div>

                {form.contactMode === "email" ? (
                  <div className="grid gap-3 lg:col-span-2">
                    <label className="grid gap-2">
                      Attachments
                      <div className="flex items-center gap-2">
                        <label className="inline-flex cursor-pointer">
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                              void handleAttachmentChange(event);
                            }}
                          />
                          <span className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm">
                            <Upload className="h-4 w-4" />
                            Add files
                          </span>
                        </label>
                      </div>
                    </label>
                    {attachments.length > 0 ? (
                      <div className="space-y-2">
                        {attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-neutral-900">{attachment.filename}</p>
                              <p className="text-xs text-neutral-500">{formatFileSize(attachment.size)}</p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setAttachments((previous) =>
                                  previous.filter((entry) => entry.id !== attachment.id)
                                )
                              }
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-2 lg:col-span-2">
                  <label className="text-sm font-medium">Metadata JSON (optional)</label>
                  <Textarea
                    rows={5}
                    className="font-mono text-xs"
                    value={metadataInput}
                    onChange={(event) => setMetadataInput(event.target.value)}
                    placeholder='{"source":"manual_outbound"}'
                  />
                  {metadataError ? <p className="m-0 text-xs text-red-600">{metadataError}</p> : null}
                </div>

                <div className="flex items-center justify-between gap-3 lg:col-span-2">
                  <div className="space-y-1" />

                  <Button type="submit" disabled={status === "submitting"}>
                    {status === "submitting"
                      ? "Creating..."
                      : form.contactMode === "call"
                        ? "Create ticket and queue call"
                        : "Create ticket and send email"}
                  </Button>
                </div>

                {createdTicketId ? (
                  <div className="flex items-center gap-2 lg:col-span-2">
                    <Badge variant="outline">
                      {createdChannel === "voice" ? "Voice" : "Email"} {createdTicketId}
                    </Badge>
                    <Button asChild type="button" variant="ghost" size="sm">
                      <Link href={`/tickets?query=${encodeURIComponent(createdTicketId)}`}>
                        Open in Support
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <ActionFeedbackModal
        open={feedback.open}
        onClose={() => setFeedback((previous) => ({ ...previous, open: false }))}
        tone={feedback.tone}
        title={feedback.title}
        message={feedback.message}
        autoCloseMs={feedback.autoCloseMs}
      />
    </AppShell>
  );
}
