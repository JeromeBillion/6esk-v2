import { apiFetch } from "@/app/lib/api/http";

export type DeskLiveNotificationItem = {
  id: string;
  channel: "support_email" | "whatsapp" | "inbox_email";
  ticketId: string | null;
  ticketDisplayId: string | null;
  subject: string | null;
  preview: string | null;
  from: string | null;
  occurredAt: string | null;
};

export type DeskLiveSnapshot = {
  snapshotAt: string;
  presence: {
    userId: string;
    status: "online" | "away" | "offline";
    activeCallSessionId: string | null;
    lastSeenAt: string | null;
    registeredAt: string | null;
  };
  versions: {
    support: string | null;
    inbox: string | null;
  };
  notifications: {
    latestSupportEmail: DeskLiveNotificationItem | null;
    latestWhatsApp: DeskLiveNotificationItem | null;
    latestInboxEmail: DeskLiveNotificationItem | null;
  };
  operators: {
    summary: {
      online: number;
      busy: number;
      away: number;
      offline: number;
    };
    roster: Array<{
      userId: string;
      displayName: string;
      email: string;
      status: "online" | "away" | "offline";
      activeCallSessionId: string | null;
    }>;
  };
};

export function getDeskLiveSnapshot(signal?: AbortSignal) {
  return apiFetch<DeskLiveSnapshot>("/api/desk/live", { signal });
}
