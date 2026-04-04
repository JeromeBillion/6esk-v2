"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Mail, MessageCircleMore, X } from "lucide-react";
import type { CurrentSessionUser } from "@/app/lib/api/session";
import { getDeskLiveSnapshot, type DeskLiveNotificationItem, type DeskLiveSnapshot } from "@/app/lib/api/desk";
import {
  buildDeskNotificationCopy,
  DESK_LIVE_EVENT_NAME,
  dispatchDeskLiveEvent,
  playDeskTone,
  type DeskLiveEventDetail
} from "@/app/lib/desk-live";
import { cn } from "@/app/workspace/components/ui/utils";

type DeskRealtimeControllerProps = {
  currentUser: CurrentSessionUser | null;
  demoModeEnabled: boolean;
};

type DeskToast = {
  id: string;
  title: string;
  message: string;
  channel: DeskLiveNotificationItem["channel"];
};

function iconForChannel(channel: DeskLiveNotificationItem["channel"]) {
  if (channel === "whatsapp") {
    return <MessageCircleMore className="h-4 w-4" />;
  }
  if (channel === "support_email" || channel === "inbox_email") {
    return <Mail className="h-4 w-4" />;
  }
  return <Bell className="h-4 w-4" />;
}

function toneForChannel(channel: DeskLiveNotificationItem["channel"]) {
  return channel === "whatsapp" ? "chat" : "email";
}

export function DeskRealtimeController({ currentUser, demoModeEnabled }: DeskRealtimeControllerProps) {
  const [toasts, setToasts] = useState<DeskToast[]>([]);
  const previousSnapshotRef = useRef<DeskLiveSnapshot | null>(null);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const autoCloseTimersRef = useRef<Map<string, number>>(new Map());
  const pollingEnabled = Boolean(currentUser && !demoModeEnabled);

  const removeToast = useCallback((toastId: string) => {
    const timeoutId = autoCloseTimersRef.current.get(toastId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      autoCloseTimersRef.current.delete(toastId);
    }
    setToasts((previous) => previous.filter((toast) => toast.id !== toastId));
  }, []);

  const pushToast = useCallback((item: DeskLiveNotificationItem) => {
    const copy = buildDeskNotificationCopy(item);
    const toastId = `${item.channel}:${item.id}`;
    setToasts((previous) => {
      if (previous.some((toast) => toast.id === toastId)) {
        return previous;
      }
      const nextToast = {
        id: toastId,
        title: copy.title,
        message: copy.message,
        channel: item.channel
      } satisfies DeskToast;
      return [nextToast, ...previous].slice(0, 4);
    });
    const timeoutId = window.setTimeout(() => removeToast(toastId), 5000);
    autoCloseTimersRef.current.set(toastId, timeoutId);
  }, [removeToast]);

  const handleSnapshot = useCallback(
    async (snapshot: DeskLiveSnapshot) => {
      const previous = previousSnapshotRef.current;
      const supportVersionChanged = Boolean(previous && snapshot.versions.support !== previous.versions.support);
      const inboxVersionChanged = Boolean(previous && snapshot.versions.inbox !== previous.versions.inbox);

      dispatchDeskLiveEvent({
        snapshot,
        supportVersionChanged,
        inboxVersionChanged
      } satisfies DeskLiveEventDetail);

      const shouldNotify = snapshot.presence.status === "online";
      const notificationCandidates = [
        snapshot.notifications.latestSupportEmail,
        snapshot.notifications.latestWhatsApp,
        snapshot.notifications.latestInboxEmail
      ].filter((item): item is DeskLiveNotificationItem => Boolean(item));

      if (!previous) {
        for (const item of notificationCandidates) {
          seenNotificationIdsRef.current.add(`${item.channel}:${item.id}`);
        }
        previousSnapshotRef.current = snapshot;
        return;
      }

      if (shouldNotify) {
        for (const item of notificationCandidates) {
          const seenKey = `${item.channel}:${item.id}`;
          if (seenNotificationIdsRef.current.has(seenKey)) {
            continue;
          }
          seenNotificationIdsRef.current.add(seenKey);
          pushToast(item);
          void playDeskTone(toneForChannel(item.channel));
        }
      } else {
        for (const item of notificationCandidates) {
          seenNotificationIdsRef.current.add(`${item.channel}:${item.id}`);
        }
      }

      previousSnapshotRef.current = snapshot;
    },
    [pushToast]
  );

  const pollSnapshot = useCallback(async () => {
    if (!pollingEnabled || document.visibilityState === "hidden") {
      return;
    }
    try {
      const snapshot = await getDeskLiveSnapshot();
      await handleSnapshot(snapshot);
    } catch {
      // Ignore transient polling failures; the next interval will retry.
    }
  }, [handleSnapshot, pollingEnabled]);

  useEffect(() => {
    if (!pollingEnabled) {
      previousSnapshotRef.current = null;
      seenNotificationIdsRef.current.clear();
      setToasts([]);
      return;
    }

    void pollSnapshot();
    const interval = window.setInterval(() => {
      void pollSnapshot();
    }, 12000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pollSnapshot();
      }
    };

    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pollSnapshot, pollingEnabled]);

  useEffect(() => {
    const timers = autoCloseTimersRef.current;
    return () => {
      for (const timeoutId of timers.values()) {
        window.clearTimeout(timeoutId);
      }
      timers.clear();
    };
  }, []);

  const hasToasts = useMemo(() => toasts.length > 0, [toasts.length]);

  if (!hasToasts) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[60] flex w-[320px] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto rounded-2xl border border-neutral-200 bg-white/96 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/96 dark:shadow-[0_18px_40px_rgba(0,0,0,0.32)]"
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                toast.channel === "whatsapp"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
              )}
            >
              {iconForChannel(toast.channel)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{toast.title}</p>
              <p className="mt-1 text-xs leading-5 text-neutral-600 dark:text-neutral-300">{toast.message}</p>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
