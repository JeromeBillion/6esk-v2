import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  Search,
  Star,
  Pin,
  Paperclip,
  Send,
  Inbox,
  Mail,
  MailOpen,
  Reply,
  Forward,
  MoreHorizontal,
  X
} from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../components/ui/utils";
import { ActionFeedbackModal } from "../components/ActionFeedbackModal";
import { ConfirmActionModal } from "../components/ConfirmActionModal";
import { MacroPickerModal } from "../components/MacroPickerModal";
import { useDemoMode } from "@/app/lib/demo-mode";
import {
  ApiMailbox,
  ApiMailboxMessage,
  ApiMessageDetail,
  getMailMessageDetail,
  listMailboxMessages,
  listMailboxes,
  patchMessageSpam,
  patchThreadPin,
  patchThreadRead,
  patchThreadStar,
  sendMail
} from "@/app/lib/api/mail";
import { getCurrentSessionUser, type CurrentSessionUser } from "@/app/lib/api/session";
import { listSupportMacros, type SupportMacro } from "@/app/lib/api/support";
import { encodeAttachments, formatFileSize, type EncodedAttachment } from "@/app/lib/files";
import { isAbortError } from "@/app/lib/api/http";

type MailView = "inbox" | "starred" | "sent" | "spam";

const MAIL_VIEW_VALUES = new Set(["inbox", "starred", "sent", "spam"]);

type MailThread = {
  id: string;
  subject: string;
  participants: string[];
  message_count: number;
  last_message_at: string;
  unread: boolean;
  starred: boolean;
  messages: ApiMailboxMessage[];
};

type FeedbackState = {
  open: boolean;
  tone: "success" | "error" | "info";
  title: string;
  message: string;
  autoCloseMs?: number;
};

type ComposeDraft = {
  to: string;
  subject: string;
  body: string;
};

function toTitleCase(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function deriveNameFromEmail(value: string) {
  return toTitleCase(value.split("@")[0] ?? value);
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function stripHtml(value: string) {
  return value
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function MailWorkspace() {
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const { demoModeEnabled } = useDemoMode();
  const [currentView, setCurrentView] = useState<MailView>("inbox");
  const [searchQuery, setSearchQuery] = useState("");
  const [mailboxes, setMailboxes] = useState<ApiMailbox[]>([]);
  const [activeMailboxId, setActiveMailboxId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentSessionUser | null>(null);
  const [messages, setMessages] = useState<ApiMailboxMessage[]>([]);
  const [messageDetails, setMessageDetails] = useState<Record<string, ApiMessageDetail>>({});
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeDraft, setComposeDraft] = useState<ComposeDraft | null>(null);
  const [replyingToMessageId, setReplyingToMessageId] = useState<string | null>(null);
  const [macros, setMacros] = useState<SupportMacro[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({
    open: false,
    tone: "info",
    title: "",
    message: ""
  });
  const openFeedback = useCallback(
    (next: Omit<FeedbackState, "open">) => {
      setFeedback({
        open: true,
        ...next
      });
    },
    []
  );

  useEffect(() => {
    const nextView = searchParams.get("view");
    if (nextView && MAIL_VIEW_VALUES.has(nextView)) {
      setCurrentView(nextView as MailView);
    }
    const nextQuery = searchParams.get("q");
    if (nextQuery !== null) {
      setSearchQuery(nextQuery);
    }
  }, [paramsKey, searchParams]);

  const activeMailbox = useMemo(
    () => mailboxes.find((mailbox) => mailbox.id === activeMailboxId) ?? null,
    [activeMailboxId, mailboxes]
  );

  const displayedInboxEmail = useMemo(() => {
    if (demoModeEnabled) {
      return "support@6esk.com";
    }
    return currentUser?.email ?? activeMailbox?.address ?? "support@6esk.com";
  }, [activeMailbox?.address, currentUser?.email, demoModeEnabled]);

  const loadMailboxes = useCallback(async () => {
    try {
      const nextMailboxes = await listMailboxes();
      setMailboxes(nextMailboxes);
      setActiveMailboxId((previous) => previous ?? nextMailboxes[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load mailboxes");
    }
  }, []);

  const loadMessages = useCallback(async (mailboxId: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setMessages(await listMailboxMessages(mailboxId, signal));
      setSelectedThreadId((previous) => previous);
    } catch (loadError) {
      if (isAbortError(loadError)) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load messages");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMailboxes();
  }, [loadMailboxes]);

  useEffect(() => {
    let cancelled = false;
    void getCurrentSessionUser()
      .then((user) => {
        if (!cancelled) {
          setCurrentUser(user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentUser(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listSupportMacros()
      .then((rows) => {
        if (!cancelled) {
          setMacros(rows.filter((macro) => macro.is_active));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMacros([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeMailboxId) {
      setMessages([]);
      return;
    }
    const controller = new AbortController();
    void loadMessages(activeMailboxId, controller.signal);
    return () => controller.abort();
  }, [activeMailboxId, loadMessages]);

  const threads = useMemo(() => {
    const grouped = new Map<string, ApiMailboxMessage[]>();
    for (const message of messages) {
      const key = message.thread_id ?? message.id;
      const list = grouped.get(key);
      if (list) {
        list.push(message);
      } else {
        grouped.set(key, [message]);
      }
    }

    const built = Array.from(grouped.entries()).map(([id, threadMessages]) => {
      const sorted = [...threadMessages].sort(
        (left, right) =>
          new Date(left.sent_at ?? left.received_at ?? left.created_at).getTime() -
          new Date(right.sent_at ?? right.received_at ?? right.created_at).getTime()
      );
      const last = sorted[sorted.length - 1]!;
      const participants = Array.from(new Set(sorted.map((message) => deriveNameFromEmail(message.from_email))));
      return {
        id,
        subject: last.subject ?? "(no subject)",
        participants,
        message_count: sorted.length,
        last_message_at: last.sent_at ?? last.received_at ?? last.created_at,
        unread: sorted.some((message) => message.direction === "inbound" && !message.is_read),
        starred: sorted.some((message) => message.is_starred),
        messages: sorted
      } satisfies MailThread;
    });

    return built.sort(
      (left, right) => new Date(right.last_message_at).getTime() - new Date(left.last_message_at).getTime()
    );
  }, [messages]);

  const filteredThreads = useMemo(() => {
    return threads.filter((thread) => {
      const matchesView =
        (currentView === "inbox" && !thread.messages.some((message) => message.is_spam)) ||
        (currentView === "starred" && thread.starred) ||
        (currentView === "sent" && thread.messages.some((message) => message.direction === "outbound")) ||
        (currentView === "spam" && thread.messages.some((message) => message.is_spam));
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        thread.subject.toLowerCase().includes(query) ||
        thread.participants.some((participant) => participant.toLowerCase().includes(query));
      return matchesView && matchesSearch;
    });
  }, [currentView, searchQuery, threads]);

  const selectedThread = useMemo(
    () => filteredThreads.find((thread) => thread.id === selectedThreadId) ?? null,
    [filteredThreads, selectedThreadId]
  );

  useEffect(() => {
    if (!selectedThread) return;
    const missingIds = selectedThread.messages
      .map((message) => message.id)
      .filter((id) => !messageDetails[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    setLoadingDetails(true);
    void Promise.all(
      missingIds.map((id) =>
        getMailMessageDetail(id).catch(() => null)
      )
    )
      .then((rows) => {
        if (cancelled) return;
        setMessageDetails((previous) => {
          const next = { ...previous };
          for (const row of rows) {
            if (row?.message?.id) {
              next[row.message.id] = row;
            }
          }
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false);
      });

    return () => {
      cancelled = true;
    };
  }, [messageDetails, selectedThread]);

  const toggleStar = async (thread: MailThread, event: React.MouseEvent) => {
    event.stopPropagation();
    const anchorMessage = thread.messages[thread.messages.length - 1];
    if (!anchorMessage) return;

    try {
      const payload = await patchThreadStar(anchorMessage.id, !thread.starred);
      const updated = new Set(payload.updatedIds ?? []);
      setMessages((previous) =>
        previous.map((message) =>
          updated.has(message.id) ? { ...message, is_starred: !thread.starred } : message
        )
      );
    } catch (toggleError) {
      const message = toggleError instanceof Error ? toggleError.message : "Failed to update message";
      setError(message);
      openFeedback({
        tone: "error",
        title: "Update failed",
        message
      });
    }
  };

  const togglePin = async (thread: MailThread, event: React.MouseEvent) => {
    event.stopPropagation();
    const anchorMessage = thread.messages[thread.messages.length - 1];
    if (!anchorMessage) return;

    try {
      const payload = await patchThreadPin(anchorMessage.id, !anchorMessage.is_pinned);
      const updated = new Set(payload.updatedIds ?? []);
      setMessages((previous) =>
        previous.map((message) =>
          updated.has(message.id) ? { ...message, is_pinned: !anchorMessage.is_pinned } : message
        )
      );
    } catch (toggleError) {
      const message = toggleError instanceof Error ? toggleError.message : "Failed to pin thread";
      setError(message);
      openFeedback({
        tone: "error",
        title: "Update failed",
        message
      });
    }
  };

  const setThreadRead = useCallback(
    async (thread: MailThread, isRead: boolean, options?: { silent?: boolean }) => {
      const anchorMessage = thread.messages[thread.messages.length - 1];
      if (!anchorMessage) return;

      try {
        const payload = await patchThreadRead(anchorMessage.id, isRead);
        const updated = new Set(payload.updatedIds ?? []);
        setMessages((previous) =>
          previous.map((message) =>
            updated.has(message.id) ? { ...message, is_read: isRead } : message
          )
        );
        if (!options?.silent) {
          openFeedback({
            tone: "success",
            title: isRead ? "Marked as read" : "Marked as unread",
            message: isRead
              ? "Conversation is now marked as read."
              : "Conversation is now marked as unread.",
            autoCloseMs: 1500
          });
        }
      } catch (toggleError) {
        const message = toggleError instanceof Error ? toggleError.message : "Failed to update read state";
        setError(message);
        if (!options?.silent) {
          openFeedback({
            tone: "error",
            title: "Update failed",
            message
          });
        }
      }
    },
    [openFeedback]
  );

  const toggleMessageSpam = useCallback(
    async (message: ApiMailboxMessage, nextSpamState: boolean) => {
      try {
        await patchMessageSpam(message.id, nextSpamState, nextSpamState ? "flagged_from_mail_workspace" : null);
        setMessages((previous) =>
          previous.map((entry) =>
            entry.id === message.id
              ? { ...entry, is_spam: nextSpamState, spam_reason: nextSpamState ? "flagged_from_mail_workspace" : null }
              : entry
          )
        );
        openFeedback({
          tone: "success",
          title: nextSpamState ? "Marked as spam" : "Removed from spam",
          message: nextSpamState
            ? "This message is now flagged as spam."
            : "This message was removed from spam.",
          autoCloseMs: 1500
        });
      } catch (toggleError) {
        const messageText = toggleError instanceof Error ? toggleError.message : "Failed to update spam status";
        setError(messageText);
        openFeedback({
          tone: "error",
          title: "Spam update failed",
          message: messageText
        });
      }
    },
    [openFeedback]
  );

  const sendEmail = useCallback(
    async (to: string, subject: string, body: string, attachments?: EncodedAttachment[]) => {
      if (!activeMailbox?.address) {
        const message = "No mailbox selected.";
        setError(message);
        openFeedback({
          tone: "error",
          title: "Send failed",
          message
        });
        return false;
      }
      if (!to.trim() || !subject.trim() || (!body.trim() && !(attachments?.length ?? 0))) {
        const message = "To and subject are required, plus a body or attachment.";
        setError(message);
        openFeedback({
          tone: "error",
          title: "Missing fields",
          message
        });
        return false;
      }

      setSending(true);
      setError(null);
      try {
        await sendMail({
          from: activeMailbox.address,
          to: [to.trim()],
          subject: subject.trim(),
          text: body.trim(),
          attachments:
            attachments?.map((attachment) => ({
              filename: attachment.filename,
              contentType: attachment.contentType,
              contentBase64: attachment.contentBase64
            })) ?? []
        });
        if (activeMailboxId) {
          await loadMessages(activeMailboxId);
        }
        openFeedback({
          tone: "success",
          title: "Message sent",
          message: "Your email was sent and the thread list has been refreshed.",
          autoCloseMs: 1500
        });
        return true;
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : "Failed to send email";
        setError(message);
        openFeedback({
          tone: "error",
          title: "Send failed",
          message
        });
        return false;
      } finally {
        setSending(false);
      }
    },
    [activeMailbox?.address, activeMailboxId, loadMessages, openFeedback]
  );

  const inboxCount = useMemo(
    () => threads.filter((thread) => !thread.messages.some((message) => message.is_spam)).length,
    [threads]
  );

  const spamCount = useMemo(
    () => threads.filter((thread) => thread.messages.some((message) => message.is_spam)).length,
    [threads]
  );

  return (
    <div className="h-full flex">
      <div className="w-56 border-r border-neutral-200 bg-white flex flex-col p-3">
        <Button
          className="w-full mb-4 gap-2"
          onClick={() => {
            setComposing(true);
            setComposeDraft(null);
            setSelectedThreadId(null);
            setReplyingToMessageId(null);
          }}
        >
          <Send className="w-4 h-4" />
          Compose
        </Button>

        <nav className="space-y-1">
          <button
            onClick={() => setCurrentView("inbox")}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              currentView === "inbox"
                ? "bg-neutral-100 text-neutral-900 font-medium"
                : "text-neutral-600 hover:bg-neutral-50"
            )}
          >
            <Inbox className="w-4 h-4" />
            <span>Inbox</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              {inboxCount}
            </Badge>
          </button>

          <button
            onClick={() => setCurrentView("starred")}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              currentView === "starred"
                ? "bg-neutral-100 text-neutral-900 font-medium"
                : "text-neutral-600 hover:bg-neutral-50"
            )}
          >
            <Star className="w-4 h-4" />
            <span>Starred</span>
          </button>

          <button
            onClick={() => setCurrentView("sent")}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              currentView === "sent"
                ? "bg-neutral-100 text-neutral-900 font-medium"
                : "text-neutral-600 hover:bg-neutral-50"
            )}
          >
            <Send className="w-4 h-4" />
            <span>Sent</span>
          </button>

          <button
            onClick={() => setCurrentView("spam")}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              currentView === "spam"
                ? "bg-neutral-100 text-neutral-900 font-medium"
                : "text-neutral-600 hover:bg-neutral-50"
            )}
          >
            <MoreHorizontal className="w-4 h-4" />
            <span>Spam</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              {spamCount}
            </Badge>
          </button>
        </nav>
      </div>

      <div className="w-[420px] border-r border-neutral-200 bg-white flex flex-col">
        <div className="border-b border-neutral-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-semibold capitalize">{currentView}</h1>
              <span className="text-sm text-neutral-500">{displayedInboxEmail}</span>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              placeholder="Search mail..."
              className="h-8 pr-9"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="p-6 text-sm text-neutral-600">Loading messages...</div> : null}
          {error ? <div className="p-6 text-sm text-red-600">{error}</div> : null}

          {!loading && !error
            ? filteredThreads.map((thread) => {
                const lastMessage = thread.messages[thread.messages.length - 1];
                return (
                  <div
                    key={thread.id}
                    className={cn(
                      "border-b border-neutral-200 p-4 cursor-pointer hover:bg-neutral-50 transition-colors",
                      selectedThread?.id === thread.id && "bg-blue-50 hover:bg-blue-50",
                      thread.unread && "bg-blue-50/30"
                    )}
                    onClick={() => {
                      setSelectedThreadId(thread.id);
                      setComposing(false);
                      setReplyingToMessageId(null);
                      if (thread.unread) {
                        void setThreadRead(thread, true, { silent: true });
                      }
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        onClick={(event) => void toggleStar(thread, event)}
                        className="mt-1 text-neutral-400 hover:text-yellow-500 transition-colors"
                      >
                        <Star className={cn("w-4 h-4", thread.starred && "fill-yellow-500 text-yellow-500")} />
                      </button>
                      <button
                        onClick={(event) => void togglePin(thread, event)}
                        className="mt-1 text-neutral-400 hover:text-blue-500 transition-colors"
                      >
                        <Pin
                          className={cn(
                            "w-4 h-4",
                            thread.messages.some((message) => message.is_pinned) && "fill-blue-500 text-blue-500"
                          )}
                        />
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void setThreadRead(thread, thread.unread);
                        }}
                        className={cn(
                          "mt-1 transition-colors",
                          thread.unread
                            ? "text-blue-500 hover:text-blue-600"
                            : "text-neutral-400 hover:text-neutral-700"
                        )}
                        aria-label={thread.unread ? "Mark thread as read" : "Mark thread as unread"}
                      >
                        {thread.unread ? (
                          <MailOpen className="w-4 h-4" />
                        ) : (
                          <Mail className="w-4 h-4" />
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {deriveNameFromEmail(lastMessage.from_email)}
                            </span>
                            {thread.unread ? <div className="w-2 h-2 rounded-full bg-blue-500" /> : null}
                          </div>
                          <span className="text-xs text-neutral-500 whitespace-nowrap">
                            {formatDate(thread.last_message_at)}
                          </span>
                        </div>

                        <h3 className="font-medium text-sm mb-1 truncate">{thread.subject}</h3>

                        <p className="text-xs text-neutral-600 line-clamp-2 mb-2">
                          {lastMessage.preview_text ?? "(no preview)"}
                        </p>

                        <div className="flex items-center gap-2">
                          {lastMessage.has_attachments ? <Paperclip className="w-3 h-3 text-neutral-400" /> : null}
                          {thread.messages.some((message) => message.is_pinned) ? (
                            <span className="text-xs text-neutral-500">Pinned</span>
                          ) : null}
                          {thread.messages.some((message) => message.is_spam) ? (
                            <Badge variant="outline" className="h-5 text-[10px] border-red-200 bg-red-50 text-red-700">
                              Spam
                            </Badge>
                          ) : null}
                          {thread.message_count > 1 ? (
                            <span className="text-xs text-neutral-500">{thread.message_count} messages</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            : null}

          {!loading && !error && filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-neutral-600 mb-1">No messages found</p>
              <p className="text-xs text-neutral-500">Try adjusting your search</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 bg-neutral-50 flex flex-col">
        {composing ? (
          <ComposeView
            macros={macros}
            initialDraft={composeDraft}
            sending={sending}
            onClose={() => {
              setComposing(false);
              setComposeDraft(null);
            }}
            onSend={async (to, subject, body, attachments) => {
              const success = await sendEmail(to, subject, body, attachments);
              if (success) {
                setComposing(false);
                setComposeDraft(null);
              }
            }}
          />
        ) : selectedThread ? (
          <ThreadView
            thread={selectedThread}
            macros={macros}
            messageDetails={messageDetails}
            loadingDetails={loadingDetails}
            replyingToMessageId={replyingToMessageId}
            sending={sending}
            onReply={(messageId) => setReplyingToMessageId(messageId)}
            onCancelReply={() => setReplyingToMessageId(null)}
            onForward={(message, body) => {
              const subject = message.subject
                ? message.subject.toLowerCase().startsWith("fwd:")
                  ? message.subject
                  : `Fwd: ${message.subject}`
                : "Fwd: (no subject)";
              const forwardedBody = `\n\n---------- Forwarded message ----------\nFrom: ${message.from_email}\nSubject: ${message.subject ?? "(no subject)"}\n\n${body}`;
              setComposeDraft({
                to: "",
                subject,
                body: forwardedBody
              });
              setComposing(true);
              setReplyingToMessageId(null);
            }}
            onSendReply={async (message, body, attachments) => {
              const detail = messageDetails[message.id];
              const recipient = detail?.message.from ?? message.from_email;
              const subject = message.subject
                ? message.subject.toLowerCase().startsWith("re:")
                  ? message.subject
                  : `Re: ${message.subject}`
                : "Re: (no subject)";
              const success = await sendEmail(recipient, subject, body, attachments);
              if (success) {
                setReplyingToMessageId(null);
              }
            }}
            threadUnread={selectedThread.unread}
            onToggleThreadRead={(nextReadState) => {
              void setThreadRead(selectedThread, nextReadState);
            }}
            onToggleSpam={(message, nextSpamState) => {
              void toggleMessageSpam(message, nextSpamState);
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Mail className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-600 mb-1">Select a message to read</p>
              <p className="text-xs text-neutral-500">Choose from your {currentView}</p>
            </div>
          </div>
        )}
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
    </div>
  );
}

function ThreadView({
  thread,
  macros,
  messageDetails,
  loadingDetails,
  replyingToMessageId,
  sending,
  onReply,
  onCancelReply,
  onForward,
  onSendReply,
  threadUnread,
  onToggleThreadRead,
  onToggleSpam
}: {
  thread: MailThread;
  macros: SupportMacro[];
  messageDetails: Record<string, ApiMessageDetail>;
  loadingDetails: boolean;
  replyingToMessageId: string | null;
  sending: boolean;
  onReply: (messageId: string) => void;
  onCancelReply: () => void;
  onForward: (message: ApiMailboxMessage, body: string) => void;
  onSendReply: (message: ApiMailboxMessage, body: string, attachments?: EncodedAttachment[]) => Promise<void>;
  threadUnread: boolean;
  onToggleThreadRead: (nextReadState: boolean) => void;
  onToggleSpam: (message: ApiMailboxMessage, nextSpamState: boolean) => void;
}) {
  const [replyText, setReplyText] = useState("");
  const [showDiscardReplyConfirm, setShowDiscardReplyConfirm] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<EncodedAttachment[]>([]);
  const [showMacroPicker, setShowMacroPicker] = useState(false);
  const [macroQuery, setMacroQuery] = useState("");

  useEffect(() => {
    setReplyText("");
    setReplyAttachments([]);
    setShowMacroPicker(false);
    setMacroQuery("");
  }, [replyingToMessageId]);

  const handleAttachmentChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const encoded = await encodeAttachments(files);
    setReplyAttachments((previous) => [...previous, ...encoded]);
    event.target.value = "";
  }, []);

  const requestCancelReply = useCallback(() => {
    if (!replyText.trim() && replyAttachments.length === 0) {
      onCancelReply();
      return;
    }
    setShowDiscardReplyConfirm(true);
  }, [onCancelReply, replyAttachments.length, replyText]);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="border-b border-neutral-200 p-6">
        <h2 className="text-xl font-semibold mb-2">{thread.subject}</h2>
        <p className="text-sm text-neutral-600">
          {thread.message_count} {thread.message_count === 1 ? "message" : "messages"} •{" "}
          {thread.participants.join(", ")}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {loadingDetails ? <p className="text-sm text-neutral-600">Loading message details...</p> : null}
        {thread.messages.map((message) => {
          const detail = messageDetails[message.id];
          const body =
            detail?.message.text ??
            (detail?.message.html ? stripHtml(detail.message.html) : null) ??
            message.preview_text ??
            "";
          const attachments = detail?.attachments ?? [];
          const isReplyingToThis = replyingToMessageId === message.id;
          return (
            <div key={message.id} className="bg-white border border-neutral-200 rounded-lg p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium">
                    {deriveNameFromEmail(message.from_email).charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{deriveNameFromEmail(message.from_email)}</span>
                      <span className="text-xs text-neutral-500">{message.from_email}</span>
                    </div>
                    {detail?.message.to?.length ? (
                      <div className="text-xs text-neutral-600">
                        <span className="font-medium">To:</span> {detail.message.to.join(", ")}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">
                    {new Date(
                      detail?.message.sentAt ?? detail?.message.receivedAt ?? message.sent_at ?? message.received_at ?? message.created_at
                    ).toLocaleString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(message.is_spam ? "text-red-600 hover:text-red-700" : "text-neutral-500")}
                    onClick={() => onToggleSpam(message, !message.is_spam)}
                  >
                    {message.is_spam ? "Unspam" : "Spam"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onReply(message.id)}>
                    <Reply className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed mb-4">{body}</div>

              {attachments.length > 0 ? (
                <div className="space-y-2">
                  <Separator />
                  <div className="pt-2">
                    <p className="text-xs font-medium text-neutral-600 mb-2">Attachments</p>
                    {attachments.map((attachment) => (
                      <a
                        key={attachment.id}
                        href={`/api/attachments/${attachment.id}`}
                        className="flex items-center gap-3 rounded-lg border border-neutral-200 p-2 transition-colors hover:bg-neutral-50"
                      >
                        <Paperclip className="w-4 h-4 text-neutral-400" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{attachment.filename}</p>
                          <p className="text-xs text-neutral-500">
                            {formatFileSize(attachment.size_bytes)}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              {isReplyingToThis ? (
                <div className="border border-neutral-200 rounded-lg p-4 bg-white mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Reply className="w-4 h-4 text-neutral-600" />
                      <span className="text-sm font-medium">
                        Replying to {deriveNameFromEmail(message.from_email)}
                      </span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={requestCancelReply}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <Textarea
                    placeholder="Type your reply..."
                    className="mb-3 resize-none"
                    rows={6}
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                  />
                  {replyAttachments.length > 0 ? (
                    <div className="mb-3 space-y-2">
                      {replyAttachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-neutral-900">
                              {attachment.filename}
                            </p>
                            <p className="text-xs text-neutral-500">{formatFileSize(attachment.size)}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setReplyAttachments((previous) =>
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
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent hover:text-accent-foreground">
                        <input type="file" className="hidden" multiple onChange={(event) => void handleAttachmentChange(event)} />
                        <Paperclip className="w-4 h-4" />
                      </label>
                      <Button variant="ghost" size="sm" onClick={() => setShowMacroPicker(true)}>
                        Macro
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      className="gap-2"
                      disabled={sending || (!replyText.trim() && replyAttachments.length === 0)}
                      onClick={() => void onSendReply(message, replyText, replyAttachments)}
                    >
                      <Send className="w-4 h-4" />
                      {sending ? "Sending..." : "Send"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {!replyingToMessageId ? (
        <div className="border-t border-neutral-200 p-4 bg-neutral-50">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="gap-2"
              onClick={() => onReply(thread.messages[thread.messages.length - 1]!.id)}
            >
              <Reply className="w-4 h-4" />
              Reply
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => onToggleThreadRead(threadUnread)}
            >
              {threadUnread ? <MailOpen className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
              {threadUnread ? "Mark read" : "Mark unread"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() =>
                onForward(
                  thread.messages[thread.messages.length - 1]!,
                  stripHtml(
                    messageDetails[thread.messages[thread.messages.length - 1]!.id]?.message.html ??
                      messageDetails[thread.messages[thread.messages.length - 1]!.id]?.message.text ??
                      thread.messages[thread.messages.length - 1]!.preview_text ??
                      ""
                  )
                )
              }
            >
              <Forward className="w-4 h-4" />
              Forward
            </Button>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmActionModal
        open={showDiscardReplyConfirm}
        title="Discard reply?"
        description="Your drafted reply will be lost."
        confirmLabel="Discard"
        onCancel={() => setShowDiscardReplyConfirm(false)}
        onConfirm={() => {
          setShowDiscardReplyConfirm(false);
          setReplyText("");
          setReplyAttachments([]);
          onCancelReply();
        }}
      />

      <MacroPickerModal
        open={showMacroPicker}
        onClose={() => setShowMacroPicker(false)}
        macros={macros}
        query={macroQuery}
        onQueryChange={setMacroQuery}
        onInsert={(macro) => {
          setReplyText((previous) => (previous ? `${previous}\n\n${macro.body}` : macro.body));
          setShowMacroPicker(false);
        }}
      />
    </div>
  );
}

function ComposeView({
  onClose,
  onSend,
  sending,
  initialDraft,
  macros
}: {
  onClose: () => void;
  onSend: (to: string, subject: string, body: string, attachments?: EncodedAttachment[]) => Promise<void>;
  sending: boolean;
  initialDraft: ComposeDraft | null;
  macros: SupportMacro[];
}) {
  const [to, setTo] = useState(initialDraft?.to ?? "");
  const [subject, setSubject] = useState(initialDraft?.subject ?? "");
  const [body, setBody] = useState(initialDraft?.body ?? "");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [attachments, setAttachments] = useState<EncodedAttachment[]>([]);
  const [showMacroPicker, setShowMacroPicker] = useState(false);
  const [macroQuery, setMacroQuery] = useState("");

  useEffect(() => {
    setTo(initialDraft?.to ?? "");
    setSubject(initialDraft?.subject ?? "");
    setBody(initialDraft?.body ?? "");
    setAttachments([]);
    setShowMacroPicker(false);
    setMacroQuery("");
  }, [initialDraft]);

  const requestClose = useCallback(() => {
    if (!to.trim() && !subject.trim() && !body.trim() && attachments.length === 0) {
      onClose();
      return;
    }
    setShowDiscardConfirm(true);
  }, [attachments.length, body, onClose, subject, to]);

  const handleAttachmentChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const encoded = await encodeAttachments(files);
    setAttachments((previous) => [...previous, ...encoded]);
    event.target.value = "";
  }, []);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="border-b border-neutral-200 p-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">New Message</h2>
        <Button variant="ghost" size="sm" onClick={requestClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <div>
            <label className="text-xs font-medium text-neutral-600 mb-1 block">To</label>
            <Input
              placeholder="recipient@example.com"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-600 mb-1 block">Subject</label>
            <Input
              placeholder="Message subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-600 mb-1 block">Message</label>
            <Textarea
              placeholder="Type your message..."
              className="resize-none"
              rows={16}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>

          {attachments.length > 0 ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-600">Attachments</label>
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-neutral-900">{attachment.filename}</p>
                    <p className="text-xs text-neutral-500">{formatFileSize(attachment.size)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setAttachments((previous) => previous.filter((entry) => entry.id !== attachment.id))
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-neutral-200 p-4 bg-neutral-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-accent hover:text-accent-foreground">
              <input type="file" className="hidden" multiple onChange={(event) => void handleAttachmentChange(event)} />
              <Paperclip className="w-4 h-4" />
            </label>
            <Button variant="ghost" size="sm" onClick={() => setShowMacroPicker(true)}>
              Macro
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={requestClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-2"
              disabled={sending || !to.trim() || !subject.trim() || (!body.trim() && attachments.length === 0)}
              onClick={() => void onSend(to, subject, body, attachments)}
            >
              <Send className="w-4 h-4" />
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmActionModal
        open={showDiscardConfirm}
        title="Discard message?"
        description="Your unsent email draft will be removed."
        confirmLabel="Discard"
        onCancel={() => setShowDiscardConfirm(false)}
        onConfirm={() => {
          setShowDiscardConfirm(false);
          onClose();
        }}
      />

      <MacroPickerModal
        open={showMacroPicker}
        onClose={() => setShowMacroPicker(false)}
        macros={macros}
        query={macroQuery}
        onQueryChange={setMacroQuery}
        onInsert={(macro) => {
          setBody((previous) => (previous ? `${previous}\n\n${macro.body}` : macro.body));
          setShowMacroPicker(false);
        }}
      />
    </div>
  );
}
