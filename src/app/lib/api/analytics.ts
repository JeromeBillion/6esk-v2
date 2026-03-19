import { apiFetch } from "@/app/lib/api/http";

export type OverviewResponse = {
  totalTickets: number;
  openTickets: number;
  ticketsCreatedToday: number;
  ticketsSolvedToday: number;
  avgFirstResponseSeconds: number;
  avgResolutionSeconds: number;
  channels: {
    email: { inbound: number; outbound: number };
    whatsapp: {
      inbound: number;
      outbound: number;
      sent: number;
      delivered: number;
      read: number;
      failed: number;
    };
    voice: {
      inbound: number;
      outbound: number;
      completed: number;
      failed: number;
      noAnswer: number;
      busy: number;
      canceled: number;
      avgDurationSeconds: number;
    };
  };
  merges?: {
    ticketMerges: number;
    customerMerges: number;
    actorSplit: {
      aiInitiated: number;
      humanInitiated: number;
    };
    reviews: {
      pending: number;
      rejectedInRange: number;
      failedInRange: number;
      topFailureReasons: Array<{
        reason: string;
        count: number;
      }>;
    };
  };
};

export type VolumeResponse = {
  created: Array<{ day: string; count: number }>;
  solved: Array<{ day: string; count: number }>;
  email?: Array<{
    day: string;
    inbound: number;
    outbound: number;
  }>;
  voice?: Array<{
    day: string;
    inbound: number;
    outbound: number;
    completed: number;
    failed: number;
    noAnswer: number;
    busy: number;
    canceled: number;
    avgDurationSeconds: number;
  }>;
  whatsappSource?: "all" | "webhook" | "outbox";
  whatsapp?: {
    sent: Array<{ day: string; count: number }>;
    delivered: Array<{ day: string; count: number }>;
    read: Array<{ day: string; count: number }>;
    failed: Array<{ day: string; count: number }>;
  };
};

export type SlaResponse = {
  firstResponse: { total: number; compliant: number; complianceRate: number };
  resolution: { total: number; compliant: number; complianceRate: number };
};

export type PerformanceRow = {
  key: string;
  label: string;
  total: number;
  open: number;
  solved: number;
  avg_first_response_seconds: number | null;
  avg_resolution_seconds: number | null;
};

export type PerformanceResponse = {
  rows: PerformanceRow[];
};

export function getAnalyticsOverview(query: string, signal?: AbortSignal) {
  return apiFetch<OverviewResponse>(`/api/analytics/overview?${query}`, { signal });
}

export function getAnalyticsVolume(query: string, signal?: AbortSignal) {
  return apiFetch<VolumeResponse>(`/api/analytics/volume?${query}`, { signal });
}

export function getAnalyticsSla(query: string, signal?: AbortSignal) {
  return apiFetch<SlaResponse>(`/api/analytics/sla?${query}`, { signal });
}

export function getAnalyticsPerformance(
  query: string,
  groupBy: "agent" | "priority" | "tag",
  signal?: AbortSignal
) {
  return apiFetch<PerformanceResponse>(`/api/analytics/performance?${query}&groupBy=${groupBy}`, {
    signal
  });
}
