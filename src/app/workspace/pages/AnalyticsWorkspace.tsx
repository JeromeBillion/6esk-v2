import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, Calendar, Download, ChevronDown } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { cn } from "../components/ui/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "../components/ui/dropdown-menu";
import {
  OverviewResponse,
  PerformanceResponse,
  PerformanceRow,
  SlaResponse,
  VolumeResponse,
  getAnalyticsOverview,
  getAnalyticsPerformance,
  getAnalyticsSla,
  getAnalyticsVolume
} from "@/app/lib/api/analytics";
import { isAbortError } from "@/app/lib/api/http";

type TimeRange = "7d" | "30d" | "90d" | "all";
type WhatsAppSource = "all" | "webhook" | "outbox";
type ChannelFocus = "email" | "whatsapp" | "voice";


type KpiMetric = {
  id: string;
  label: string;
  value: number;
  unit?: string;
  change: number;
  trend: "up" | "down";
  format: "number" | "duration" | "percentage";
};

function rangeToDates(timeRange: TimeRange) {
  const end = new Date();
  const start = new Date(end);
  if (timeRange === "7d") start.setUTCDate(start.getUTCDate() - 7);
  if (timeRange === "30d") start.setUTCDate(start.getUTCDate() - 30);
  if (timeRange === "90d") start.setUTCDate(start.getUTCDate() - 90);
  if (timeRange === "all") start.setUTCFullYear(start.getUTCFullYear() - 3);
  return { start: start.toISOString(), end: end.toISOString() };
}

function previousRangeFromCurrent(startIso: string, endIso: string) {
  const currentStart = new Date(startIso);
  const currentEnd = new Date(endIso);
  const durationMs = Math.max(1, currentEnd.getTime() - currentStart.getTime());
  const previousEnd = new Date(currentStart);
  const previousStart = new Date(currentStart.getTime() - durationMs);
  return { start: previousStart.toISOString(), end: previousEnd.toISOString() };
}

function toHours(seconds: number) {
  return seconds > 0 ? seconds / 3600 : 0;
}

function toMinutes(seconds: number) {
  return seconds > 0 ? seconds / 60 : 0;
}

function toTitleCase(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function percentChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return 0;
  }
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return (numerator / denominator) * 100;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const escape = (value: string | number) => {
    const stringValue = String(value ?? "");
    if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
      return `"${stringValue.replace(/"/g, "\"\"")}"`;
    }
    return stringValue;
  };
  const csv = [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AnalyticsWorkspace() {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [whatsAppSource, setWhatsAppSource] = useState<WhatsAppSource>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewPrevious, setOverviewPrevious] = useState<OverviewResponse | null>(null);
  const [volume, setVolume] = useState<VolumeResponse | null>(null);
  const [sla, setSla] = useState<SlaResponse | null>(null);
  const [slaPrevious, setSlaPrevious] = useState<SlaResponse | null>(null);
  const [performanceAgent, setPerformanceAgent] = useState<PerformanceRow[]>([]);
  const [performancePriority, setPerformancePriority] = useState<PerformanceRow[]>([]);
  const [performanceTag, setPerformanceTag] = useState<PerformanceRow[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("all");
  const [selectedPriority, setSelectedPriority] = useState("all");
  const [tagFilterInput, setTagFilterInput] = useState("");
  const [appliedTagFilter, setAppliedTagFilter] = useState("");
  const [channelFocus, setChannelFocus] = useState<ChannelFocus>("email");

  const timeRangeLabels: Record<TimeRange, string> = {
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    "90d": "Last 90 days",
    all: "All time"
  };

  const loadAnalytics = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const { start, end } = rangeToDates(timeRange);
        const previousRange = previousRangeFromCurrent(start, end);
        const baseQuery = `start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
        const query = `${baseQuery}&whatsappSource=${whatsAppSource}`;
        const previousQuery = `start=${encodeURIComponent(previousRange.start)}&end=${encodeURIComponent(previousRange.end)}`;
        const performanceFilters = new URLSearchParams();
        if (selectedAgentId !== "all") {
          performanceFilters.set("agentId", selectedAgentId);
        }
        if (selectedPriority !== "all") {
          performanceFilters.set("priority", selectedPriority);
        }
        if (appliedTagFilter) {
          performanceFilters.set("tag", appliedTagFilter);
        }
        const performanceQuery = performanceFilters.size > 0
          ? `${baseQuery}&${performanceFilters.toString()}`
          : baseQuery;

        const [
          overviewPayload,
          overviewPreviousPayload,
          volumePayload,
          slaPayload,
          slaPreviousPayload,
          agentPayload,
          priorityPayload,
          tagPayload
        ] =
          await Promise.all([
            getAnalyticsOverview(query, signal),
            getAnalyticsOverview(previousQuery, signal),
            getAnalyticsVolume(query, signal),
            getAnalyticsSla(query, signal),
            getAnalyticsSla(previousQuery, signal),
            getAnalyticsPerformance(performanceQuery, "agent", signal),
            getAnalyticsPerformance(performanceQuery, "priority", signal),
            getAnalyticsPerformance(performanceQuery, "tag", signal)
          ]);

        setOverview(overviewPayload);
        setOverviewPrevious(overviewPreviousPayload);
        setVolume(volumePayload);
        setSla(slaPayload);
        setSlaPrevious(slaPreviousPayload);
        setPerformanceAgent(agentPayload.rows ?? []);
        setPerformancePriority(priorityPayload.rows ?? []);
        setPerformanceTag(tagPayload.rows ?? []);
      } catch (loadError) {
        if (isAbortError(loadError)) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load analytics");
        setOverview(null);
        setOverviewPrevious(null);
        setVolume(null);
        setSla(null);
        setSlaPrevious(null);
        setPerformanceAgent([]);
        setPerformancePriority([]);
        setPerformanceTag([]);
      } finally {
        setLoading(false);
      }
    },
    [appliedTagFilter, selectedAgentId, selectedPriority, timeRange, whatsAppSource]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadAnalytics(controller.signal);
    return () => controller.abort();
  }, [loadAnalytics]);

  const kpiMetrics = useMemo(() => {
    if (!overview || !sla) return [];
    const previous = overviewPrevious;
    const previousSla = slaPrevious;
    const openTicketsChange = percentChange(overview.openTickets, previous?.openTickets ?? 0);
    const avgFirstResponseChange = percentChange(
      toMinutes(overview.avgFirstResponseSeconds),
      toMinutes(previous?.avgFirstResponseSeconds ?? 0)
    );
    const avgResolutionChange = percentChange(
      toHours(overview.avgResolutionSeconds),
      toHours(previous?.avgResolutionSeconds ?? 0)
    );
    const firstResponseSlaChange = percentChange(
      sla.firstResponse.complianceRate * 100,
      (previousSla?.firstResponse.complianceRate ?? 0) * 100
    );
    const resolutionSlaChange = percentChange(
      sla.resolution.complianceRate * 100,
      (previousSla?.resolution.complianceRate ?? 0) * 100
    );

    return [
      {
        id: "total-tickets",
        label: "Total Tickets",
        value: overview.totalTickets,
        change: percentChange(overview.totalTickets, previous?.totalTickets ?? 0),
        trend: overview.totalTickets >= (previous?.totalTickets ?? 0) ? "up" : "down",
        format: "number"
      },
      {
        id: "open-tickets",
        label: "Open Tickets",
        value: overview.openTickets,
        change: openTicketsChange,
        trend: openTicketsChange >= 0 ? "up" : "down",
        format: "number"
      },
      {
        id: "avg-first-response",
        label: "Avg First Response",
        value: toMinutes(overview.avgFirstResponseSeconds),
        unit: "min",
        change: avgFirstResponseChange,
        trend: avgFirstResponseChange >= 0 ? "up" : "down",
        format: "duration"
      },
      {
        id: "avg-resolution",
        label: "Avg Resolution",
        value: toHours(overview.avgResolutionSeconds),
        unit: "hrs",
        change: avgResolutionChange,
        trend: avgResolutionChange >= 0 ? "up" : "down",
        format: "duration"
      },
      {
        id: "first-response-sla",
        label: "First Response SLA",
        value: sla.firstResponse.complianceRate * 100,
        unit: "%",
        change: firstResponseSlaChange,
        trend: firstResponseSlaChange >= 0 ? "up" : "down",
        format: "percentage"
      },
      {
        id: "resolution-sla",
        label: "Resolution SLA",
        value: sla.resolution.complianceRate * 100,
        unit: "%",
        change: resolutionSlaChange,
        trend: resolutionSlaChange >= 0 ? "up" : "down",
        format: "percentage"
      }
    ] satisfies KpiMetric[];
  }, [overview, overviewPrevious, sla, slaPrevious]);

  const timeSeries = useMemo(() => {
    if (!volume || !overview || !sla) return [];
    const byDay = new Map<string, { tickets: number; resolved: number }>();

    for (const item of volume.created ?? []) {
      byDay.set(item.day, { tickets: item.count, resolved: 0 });
    }
    for (const item of volume.solved ?? []) {
      const current = byDay.get(item.day);
      if (current) {
        current.resolved = item.count;
      } else {
        byDay.set(item.day, { tickets: 0, resolved: item.count });
      }
    }

    return Array.from(byDay.entries())
      .sort(([left], [right]) => new Date(left).getTime() - new Date(right).getTime())
      .map(([day, value]) => ({
        date: day,
        tickets: value.tickets,
        resolved: value.resolved,
        avgResponseTime: toMinutes(overview.avgFirstResponseSeconds),
        satisfaction: Math.min(5, Math.max(0, sla.resolution.complianceRate * 5))
      }));
  }, [overview, sla, volume]);

  const channelDistribution = useMemo(() => {
    if (!overview) return [];
    const channels = [
      { channel: "Email", count: overview.channels.email.inbound + overview.channels.email.outbound },
      { channel: "WhatsApp", count: overview.channels.whatsapp.inbound + overview.channels.whatsapp.outbound },
      { channel: "Voice", count: overview.channels.voice.inbound + overview.channels.voice.outbound }
    ];
    const total = channels.reduce((sum, channel) => sum + channel.count, 0) || 1;
    return channels.map((channel) => ({
      ...channel,
      percentage: Number(((channel.count / total) * 100).toFixed(1))
    }));
  }, [overview]);

  const priorityBreakdown = useMemo(
    () =>
      performancePriority.map((row) => ({
        priority: toTitleCase(row.label),
        count: row.total,
        avgResolutionTime: row.avg_resolution_seconds ? toHours(row.avg_resolution_seconds) : 0
      })),
    [performancePriority]
  );

  const agentPerformance = useMemo(
    () =>
      performanceAgent.map((row) => ({
        agent: row.label,
        ticketsHandled: row.total,
        avgResponseTime: row.avg_first_response_seconds ? toMinutes(row.avg_first_response_seconds) : 0,
        avgResolutionTime: row.avg_resolution_seconds ? toHours(row.avg_resolution_seconds) : 0,
        satisfaction: 5
      })),
    [performanceAgent]
  );

  const topTags = useMemo(
    () =>
      performanceTag
        .slice(0, 8)
        .map((row) => ({
          tag: row.label,
          count: row.total
        })),
    [performanceTag]
  );

  const mergeMetrics = useMemo(() => {
    if (!overview?.merges) return null;
    return [
      { label: "Ticket merges", value: overview.merges.ticketMerges },
      { label: "Customer merges", value: overview.merges.customerMerges },
      { label: "Pending reviews", value: overview.merges.reviews.pending },
      { label: "Rejected reviews", value: overview.merges.reviews.rejectedInRange },
      { label: "Failed reviews", value: overview.merges.reviews.failedInRange }
    ];
  }, [overview]);

  const mergeMetricAction = useCallback((label: string) => {
    if (label === "Pending reviews") {
      return { href: "/tickets/merge-reviews?status=pending", label: "Open reviews" };
    }
    if (label === "Rejected reviews") {
      return { href: "/tickets/merge-reviews?status=rejected", label: "Open reviews" };
    }
    if (label === "Failed reviews") {
      return { href: "/tickets/merge-reviews?status=failed", label: "Open reviews" };
    }
    if (label === "Ticket merges") {
      return { href: "/tickets?query=merge", label: "Open queue" };
    }
    if (label === "Customer merges") {
      return { href: "/tickets?query=customer%20merge", label: "Open queue" };
    }
    return null;
  }, []);

  const mergeActorSplit = useMemo(() => {
    if (!overview?.merges) return [];
    return [
      { actor: "AI initiated", value: overview.merges.actorSplit.aiInitiated },
      { actor: "Human initiated", value: overview.merges.actorSplit.humanInitiated }
    ];
  }, [overview]);

  const priorityOptions = useMemo(
    () =>
      performancePriority
        .map((row) => row.key)
        .filter((value): value is string => Boolean(value && value.trim())),
    [performancePriority]
  );
  const selectedAgentLabel = useMemo(() => {
    if (selectedAgentId === "all") return "All";
    const found = performanceAgent.find((row) => row.key === selectedAgentId);
    return found?.label ?? selectedAgentId;
  }, [performanceAgent, selectedAgentId]);

  const emailSeries = useMemo(
    () =>
      (volume?.email ?? []).map((item) => ({
        date: item.day,
        inbound: item.inbound,
        outbound: item.outbound,
        total: item.inbound + item.outbound
      })),
    [volume]
  );
  const emailTotals = useMemo(() => {
    const inbound = overview?.channels.email.inbound ?? 0;
    const outbound = overview?.channels.email.outbound ?? 0;
    return {
      inbound,
      outbound,
      total: inbound + outbound,
      outboundShare: safeRate(outbound, inbound + outbound)
    };
  }, [overview]);
  const emailPeakDay = useMemo(() => {
    if (emailSeries.length === 0) {
      return { date: "-", total: 0 };
    }
    return emailSeries.reduce((peak, item) => (item.total > peak.total ? item : peak), emailSeries[0]);
  }, [emailSeries]);

  const voiceOutcomes = useMemo(() => {
    return (volume?.voice ?? []).map((item) => ({
      date: item.day,
      completed: item.completed,
      failed: item.failed,
      noAnswer: item.noAnswer,
      busy: item.busy,
      canceled: item.canceled
    }));
  }, [volume]);
  const voiceDrilldownRows = useMemo(
    () =>
      (volume?.voice ?? []).map((item) => ({
        date: item.day,
        inbound: item.inbound,
        outbound: item.outbound,
        completed: item.completed,
        failed: item.failed,
        noAnswer: item.noAnswer,
        busy: item.busy,
        canceled: item.canceled,
        avgDurationSeconds: item.avgDurationSeconds,
        connectRate: safeRate(item.completed, item.outbound)
      })),
    [volume]
  );
  const voiceRates = useMemo(() => {
    const outbound = overview?.channels.voice.outbound ?? 0;
    const completed = overview?.channels.voice.completed ?? 0;
    const failed = overview?.channels.voice.failed ?? 0;
    return {
      connectRate: safeRate(completed, outbound),
      failureRate: safeRate(failed, outbound),
      avgDurationSeconds: overview?.channels.voice.avgDurationSeconds ?? 0
    };
  }, [overview]);

  const voiceQaSummary = useMemo(() => {
    return (
      overview?.voiceQa ?? {
        analyzed: 0,
        pass: 0,
        watch: 0,
        review: 0,
        flagged: 0,
        totalFlags: 0,
        totalActionItems: 0
      }
    );
  }, [overview]);

  const voiceQaSeries = useMemo(
    () =>
      (volume?.voiceQa ?? []).map((item) => ({
        date: item.day,
        analyzed: item.analyzed,
        pass: item.pass,
        watch: item.watch,
        review: item.review,
        flagged: item.flagged,
        totalFlags: item.totalFlags
      })),
    [volume]
  );

  const whatsAppStatusSeries = useMemo(() => {
    const sent = volume?.whatsapp?.sent ?? [];
    const delivered = volume?.whatsapp?.delivered ?? [];
    const read = volume?.whatsapp?.read ?? [];
    const failed = volume?.whatsapp?.failed ?? [];
    const days = new Set([
      ...sent.map((item) => item.day),
      ...delivered.map((item) => item.day),
      ...read.map((item) => item.day),
      ...failed.map((item) => item.day)
    ]);
    return Array.from(days)
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())
      .map((day) => ({
        date: day,
        sent: sent.find((item) => item.day === day)?.count ?? 0,
        delivered: delivered.find((item) => item.day === day)?.count ?? 0,
        read: read.find((item) => item.day === day)?.count ?? 0,
        failed: failed.find((item) => item.day === day)?.count ?? 0
      }));
  }, [volume]);
  const whatsAppDrilldownRows = useMemo(
    () =>
      whatsAppStatusSeries.map((item) => ({
        ...item,
        deliveredRate: safeRate(item.delivered, item.sent),
        readRate: safeRate(item.read, item.delivered),
        failedRate: safeRate(item.failed, item.sent)
      })),
    [whatsAppStatusSeries]
  );
  const whatsAppRates = useMemo(() => {
    const sent = overview?.channels.whatsapp.sent ?? 0;
    const delivered = overview?.channels.whatsapp.delivered ?? 0;
    const read = overview?.channels.whatsapp.read ?? 0;
    const failed = overview?.channels.whatsapp.failed ?? 0;
    return {
      deliveredRate: safeRate(delivered, sent),
      readRate: safeRate(read, delivered),
      failedRate: safeRate(failed, sent)
    };
  }, [overview]);

  const COLORS = {
    primary: "#3b82f6",
    secondary: "#8b5cf6",
    success: "#10b981",
    neutral: "#6b7280"
  };
  const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

  const formatValue = (metric: KpiMetric) => {
    if (metric.format === "number") return metric.value >= 1000 ? `${(metric.value / 1000).toFixed(1)}k` : metric.value.toFixed(0);
    if (metric.format === "duration") return metric.value.toFixed(1);
    return metric.value.toFixed(1);
  };

  const exportOverviewCsv = () => {
    if (!overview || !sla) return;
    downloadCsv(
      "analytics-overview.csv",
      ["Metric", "Value"],
      [
        ["Total Tickets", overview.totalTickets],
        ["Open Tickets", overview.openTickets],
        ["Tickets Created Today", overview.ticketsCreatedToday],
        ["Tickets Solved Today", overview.ticketsSolvedToday],
        ["Avg First Response Seconds", overview.avgFirstResponseSeconds.toFixed(2)],
        ["Avg Resolution Seconds", overview.avgResolutionSeconds.toFixed(2)],
        ["First Response SLA", (sla.firstResponse.complianceRate * 100).toFixed(2)],
        ["Resolution SLA", (sla.resolution.complianceRate * 100).toFixed(2)]
      ]
    );
  };

  const exportVolumeCsv = () => {
    downloadCsv(
      "analytics-volume.csv",
      ["Day", "Tickets Created", "Tickets Solved"],
      timeSeries.map((item) => [item.date, item.tickets, item.resolved])
    );
  };

  const exportEmailCsv = () => {
    downloadCsv(
      "analytics-email-activity.csv",
      ["Day", "Inbound", "Outbound", "Total"],
      emailSeries.map((item) => [item.date, item.inbound, item.outbound, item.total])
    );
  };

  const exportWhatsAppCsv = () => {
    downloadCsv(
      "analytics-whatsapp-delivery.csv",
      ["Day", "Sent", "Delivered", "Read", "Failed"],
      whatsAppStatusSeries.map((item) => [
        item.date,
        item.sent,
        item.delivered,
        item.read,
        item.failed
      ])
    );
  };

  const exportVoiceCsv = () => {
    downloadCsv(
      "analytics-voice-outcomes.csv",
      ["Day", "Completed", "Failed", "No Answer", "Busy", "Canceled"],
      voiceOutcomes.map((item) => [
        item.date,
        item.completed,
        item.failed,
        item.noAnswer,
        item.busy,
        item.canceled
      ])
    );
  };

  const exportMergeCsv = () => {
    if (!overview?.merges) return;
    const summaryRows: Array<Array<string | number>> = [
      ["Ticket merges", overview.merges.ticketMerges],
      ["Customer merges", overview.merges.customerMerges],
      ["AI initiated merges", overview.merges.actorSplit.aiInitiated],
      ["Human initiated merges", overview.merges.actorSplit.humanInitiated],
      ["Pending reviews", overview.merges.reviews.pending],
      ["Rejected reviews (range)", overview.merges.reviews.rejectedInRange],
      ["Failed reviews (range)", overview.merges.reviews.failedInRange]
    ];
    const failureRows = overview.merges.reviews.topFailureReasons.map((item) => [
      `Failure: ${item.reason}`,
      item.count
    ]);
    downloadCsv(
      "analytics-merges.csv",
      ["Metric", "Value"],
      [...summaryRows, ...failureRows]
    );
  };

  const exportChannelFocusCsv = () => {
    if (channelFocus === "email") {
      exportEmailCsv();
      return;
    }
    if (channelFocus === "whatsapp") {
      exportWhatsAppCsv();
      return;
    }
    exportVoiceCsv();
  };

  const channelQueueHref = useMemo(() => {
    if (channelFocus === "email") return "/tickets?channel=email";
    if (channelFocus === "whatsapp") return "/tickets?channel=whatsapp";
    return "/tickets?channel=voice";
  }, [channelFocus]);

  return (
    <div className="h-full bg-neutral-50 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold mb-1">Analytics</h1>
            <p className="text-sm text-neutral-600">
              Performance metrics and insights for your support team
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  {timeRangeLabels[timeRange]}
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTimeRange("7d")}>Last 7 days</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTimeRange("30d")}>Last 30 days</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTimeRange("90d")}>Last 90 days</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTimeRange("all")}>All time</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  WA Source: {whatsAppSource === "all" ? "All" : toTitleCase(whatsAppSource)}
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setWhatsAppSource("all")}>All sources</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setWhatsAppSource("webhook")}>Webhook</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setWhatsAppSource("outbox")}>Outbox</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Download className="w-4 h-4" />
                  Export
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportOverviewCsv}>Overview summary</DropdownMenuItem>
                <DropdownMenuItem onClick={exportVolumeCsv}>Ticket volume</DropdownMenuItem>
                <DropdownMenuItem onClick={exportEmailCsv}>Email activity</DropdownMenuItem>
                <DropdownMenuItem onClick={exportWhatsAppCsv}>WhatsApp delivery</DropdownMenuItem>
                <DropdownMenuItem onClick={exportVoiceCsv}>Voice outcomes</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    downloadCsv(
                      "analytics-performance-agent.csv",
                      ["Agent", "Tickets", "Open", "Solved", "Avg First Response (s)", "Avg Resolution (s)"],
                      performanceAgent.map((row) => [
                        row.label,
                        row.total,
                        row.open,
                        row.solved,
                        row.avg_first_response_seconds ?? 0,
                        row.avg_resolution_seconds ?? 0
                      ])
                    )
                  }
                >
                  Performance by agent
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    downloadCsv(
                      "analytics-performance-priority.csv",
                      ["Priority", "Tickets", "Open", "Solved", "Avg First Response (s)", "Avg Resolution (s)"],
                      performancePriority.map((row) => [
                        row.label,
                        row.total,
                        row.open,
                        row.solved,
                        row.avg_first_response_seconds ?? 0,
                        row.avg_resolution_seconds ?? 0
                      ])
                    )
                  }
                >
                  Performance by priority
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    downloadCsv(
                      "analytics-performance-tag.csv",
                      ["Tag", "Tickets", "Open", "Solved", "Avg First Response (s)", "Avg Resolution (s)"],
                      performanceTag.map((row) => [
                        row.label,
                        row.total,
                        row.open,
                        row.solved,
                        row.avg_first_response_seconds ?? 0,
                        row.avg_resolution_seconds ?? 0
                      ])
                    )
                  }
                >
                  Performance by tag
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportMergeCsv}>Merge and review metrics</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
            >
              <option value="all">All agents</option>
              {performanceAgent.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
              value={selectedPriority}
              onChange={(event) => setSelectedPriority(event.target.value)}
            >
              <option value="all">All priorities</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {toTitleCase(priority)}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <Input
                value={tagFilterInput}
                onChange={(event) => setTagFilterInput(event.target.value)}
                placeholder="Filter by tag"
                className="w-44"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setAppliedTagFilter(tagFilterInput.trim().toLowerCase());
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAppliedTagFilter(tagFilterInput.trim().toLowerCase())}
              >
                Apply Tag
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedAgentId("all");
                setSelectedPriority("all");
                setTagFilterInput("");
                setAppliedTagFilter("");
              }}
            >
              Clear Filters
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Agent: {selectedAgentLabel}</Badge>
            <Badge variant="outline">
              Priority: {selectedPriority === "all" ? "All" : toTitleCase(selectedPriority)}
            </Badge>
            <Badge variant="outline">
              Tag: {appliedTagFilter ? appliedTagFilter : "All"}
            </Badge>
          </div>
        </Card>

        {loading ? <p className="text-sm text-neutral-600">Loading analytics...</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {!loading && !error ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {kpiMetrics.map((metric) => (
                <KPICard key={metric.id} metric={metric} formatValue={formatValue} />
              ))}
            </div>

            {mergeMetrics ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                {mergeMetrics.map((metric) => {
                  const action = mergeMetricAction(metric.label);
                  return (
                    <Card key={metric.label} className="p-5">
                      <p className="text-sm text-neutral-600">{metric.label}</p>
                      <p className="mt-2 text-3xl font-semibold text-neutral-900">{metric.value}</p>
                      {action ? (
                        <div className="mt-3">
                          <Button asChild size="sm" variant="outline">
                            <Link href={action.href}>{action.label}</Link>
                          </Button>
                        </div>
                      ) : null}
                    </Card>
                  );
                })}
              </div>
            ) : null}

            {overview?.merges ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="p-6">
                  <h3 className="font-semibold mb-4">Merge Actor Split</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={mergeActorSplit}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="actor" stroke="#9ca3af" fontSize={12} />
                      <YAxis stroke="#9ca3af" fontSize={12} />
                      <Tooltip />
                      <Bar dataKey="value" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
                <Card className="p-6">
                  <h3 className="font-semibold mb-4">Top Merge Failure Reasons</h3>
                  <div className="space-y-3">
                    {(overview.merges.reviews.topFailureReasons ?? []).length === 0 ? (
                      <p className="text-sm text-neutral-500">No failed reviews in the selected range.</p>
                    ) : (
                      overview.merges.reviews.topFailureReasons.map((item) => {
                        const maxCount = overview.merges?.reviews.topFailureReasons[0]?.count ?? 1;
                        const percentage = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
                        return (
                          <div key={item.reason}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-sm text-neutral-700">{item.reason}</span>
                              <span className="text-sm font-medium text-neutral-900">{item.count}</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-neutral-100">
                              <div
                                className="h-2 rounded-full bg-rose-500 transition-all"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>
              </div>
            ) : null}

            <Card className="p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Channel Drilldown</h3>
                  <p className="mt-1 text-xs text-neutral-600">
                    Deep-dive metrics and daily patterns for Email, WhatsApp, and Voice.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={channelQueueHref}>
                      Open {channelFocus === "email" ? "Email" : channelFocus === "whatsapp" ? "WhatsApp" : "Voice"} queue
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportChannelFocusCsv}>
                    Export {channelFocus === "email" ? "Email" : channelFocus === "whatsapp" ? "WhatsApp" : "Voice"}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={channelFocus === "email" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChannelFocus("email")}
                >
                  Email
                </Button>
                <Button
                  variant={channelFocus === "whatsapp" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChannelFocus("whatsapp")}
                >
                  WhatsApp
                </Button>
                <Button
                  variant={channelFocus === "voice" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChannelFocus("voice")}
                >
                  Voice
                </Button>
              </div>

              {channelFocus === "email" ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Metric label="Inbound" value={emailTotals.inbound} />
                    <Metric label="Outbound" value={emailTotals.outbound} />
                    <Metric label="Outbound Share" value={`${emailTotals.outboundShare.toFixed(1)}%`} />
                    <Metric
                      label="Peak Day"
                      value={
                        emailPeakDay.date === "-"
                          ? "-"
                          : `${new Date(emailPeakDay.date).toLocaleDateString()} (${emailPeakDay.total})`
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
                    <Card className="p-4">
                      <h4 className="text-sm font-medium text-neutral-800 mb-3">Email Daily Volume</h4>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={emailSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(date) => {
                              const parsed = new Date(date);
                              return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                            }}
                            stroke="#9ca3af"
                            fontSize={12}
                          />
                          <YAxis stroke="#9ca3af" fontSize={12} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: "12px" }} />
                          <Line type="monotone" dataKey="inbound" stroke={COLORS.primary} dot={false} />
                          <Line type="monotone" dataKey="outbound" stroke={COLORS.success} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </Card>
                    <Card className="p-4">
                      <h4 className="text-sm font-medium text-neutral-800 mb-3">Recent Email Days</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-neutral-200">
                              <th className="text-left py-2">Day</th>
                              <th className="text-right py-2">Inbound</th>
                              <th className="text-right py-2">Outbound</th>
                              <th className="text-right py-2">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {emailSeries.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="py-3 text-neutral-500">No email activity in range.</td>
                              </tr>
                            ) : (
                              [...emailSeries].slice(-8).reverse().map((item) => (
                                <tr key={item.date} className="border-b border-neutral-100">
                                  <td className="py-2">{new Date(item.date).toLocaleDateString()}</td>
                                  <td className="py-2 text-right">{item.inbound}</td>
                                  <td className="py-2 text-right">{item.outbound}</td>
                                  <td className="py-2 text-right">{item.total}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </div>
                </>
              ) : null}

              {channelFocus === "whatsapp" ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Metric
                      label="Inbound / Outbound"
                      value={`${overview?.channels.whatsapp.inbound ?? 0} / ${overview?.channels.whatsapp.outbound ?? 0}`}
                    />
                    <Metric label="Delivered Rate" value={`${whatsAppRates.deliveredRate.toFixed(1)}%`} />
                    <Metric label="Read Rate" value={`${whatsAppRates.readRate.toFixed(1)}%`} />
                    <Metric label="Failure Rate" value={`${whatsAppRates.failedRate.toFixed(1)}%`} />
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
                    <Card className="p-4">
                      <h4 className="text-sm font-medium text-neutral-800 mb-3">WhatsApp Delivery by Day</h4>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={whatsAppStatusSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(date) => {
                              const parsed = new Date(date);
                              return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                            }}
                            stroke="#9ca3af"
                            fontSize={12}
                          />
                          <YAxis stroke="#9ca3af" fontSize={12} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: "12px" }} />
                          <Line type="monotone" dataKey="sent" stroke={COLORS.primary} dot={false} />
                          <Line type="monotone" dataKey="delivered" stroke={COLORS.success} dot={false} />
                          <Line type="monotone" dataKey="read" stroke={COLORS.secondary} dot={false} />
                          <Line type="monotone" dataKey="failed" stroke="#ef4444" dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </Card>
                    <Card className="p-4">
                      <h4 className="text-sm font-medium text-neutral-800 mb-3">Recent WhatsApp Days</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-neutral-200">
                              <th className="text-left py-2">Day</th>
                              <th className="text-right py-2">Sent</th>
                              <th className="text-right py-2">Delivered%</th>
                              <th className="text-right py-2">Read%</th>
                              <th className="text-right py-2">Failed%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {whatsAppDrilldownRows.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="py-3 text-neutral-500">No WhatsApp status events in range.</td>
                              </tr>
                            ) : (
                              [...whatsAppDrilldownRows].slice(-8).reverse().map((item) => (
                                <tr key={item.date} className="border-b border-neutral-100">
                                  <td className="py-2">{new Date(item.date).toLocaleDateString()}</td>
                                  <td className="py-2 text-right">{item.sent}</td>
                                  <td className="py-2 text-right">{item.deliveredRate.toFixed(1)}%</td>
                                  <td className="py-2 text-right">{item.readRate.toFixed(1)}%</td>
                                  <td className="py-2 text-right">{item.failedRate.toFixed(1)}%</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </div>
                </>
              ) : null}

              {channelFocus === "voice" ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                    <Metric
                      label="Inbound / Outbound"
                      value={`${overview?.channels.voice.inbound ?? 0} / ${overview?.channels.voice.outbound ?? 0}`}
                    />
                    <Metric label="Connect Rate" value={`${voiceRates.connectRate.toFixed(1)}%`} />
                    <Metric label="Failure Rate" value={`${voiceRates.failureRate.toFixed(1)}%`} />
                    <Metric label="Avg Duration" value={`${voiceRates.avgDurationSeconds.toFixed(1)}s`} />
                    <Metric label="QA Flagged" value={voiceQaSummary.flagged} />
                    <Metric label="Needs Review" value={voiceQaSummary.review} />
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
                    <Card className="p-4">
                      <h4 className="text-sm font-medium text-neutral-800 mb-3">Voice Outcomes by Day</h4>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={voiceOutcomes}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(date) => {
                              const parsed = new Date(date);
                              return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                            }}
                            stroke="#9ca3af"
                            fontSize={12}
                          />
                          <YAxis stroke="#9ca3af" fontSize={12} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: "12px" }} />
                          <Bar dataKey="completed" stackId="voice" fill={COLORS.success} />
                          <Bar dataKey="failed" stackId="voice" fill="#ef4444" />
                          <Bar dataKey="noAnswer" stackId="voice" fill="#f59e0b" />
                          <Bar dataKey="busy" stackId="voice" fill="#6366f1" />
                          <Bar dataKey="canceled" stackId="voice" fill={COLORS.neutral} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>
                    <Card className="p-4">
                      <h4 className="text-sm font-medium text-neutral-800 mb-3">Recent Voice Days</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-neutral-200">
                              <th className="text-left py-2">Day</th>
                              <th className="text-right py-2">Outbound</th>
                              <th className="text-right py-2">Completed</th>
                              <th className="text-right py-2">Connect%</th>
                              <th className="text-right py-2">Avg sec</th>
                            </tr>
                          </thead>
                          <tbody>
                            {voiceDrilldownRows.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="py-3 text-neutral-500">No voice outcomes in range.</td>
                              </tr>
                            ) : (
                              [...voiceDrilldownRows].slice(-8).reverse().map((item) => (
                                <tr key={item.date} className="border-b border-neutral-100">
                                  <td className="py-2">{new Date(item.date).toLocaleDateString()}</td>
                                  <td className="py-2 text-right">{item.outbound}</td>
                                  <td className="py-2 text-right">{item.completed}</td>
                                  <td className="py-2 text-right">{item.connectRate.toFixed(1)}%</td>
                                  <td className="py-2 text-right">{item.avgDurationSeconds.toFixed(1)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-4">
                    <Card className="p-4">
                      <h4 className="text-sm font-medium text-neutral-800 mb-3">Voice QA Signals</h4>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={voiceQaSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(date) => {
                              const parsed = new Date(date);
                              return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                            }}
                            stroke="#9ca3af"
                            fontSize={12}
                          />
                          <YAxis stroke="#9ca3af" fontSize={12} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: "12px" }} />
                          <Bar dataKey="pass" stackId="qa" fill={COLORS.success} />
                          <Bar dataKey="watch" stackId="qa" fill="#f59e0b" />
                          <Bar dataKey="review" stackId="qa" fill="#ef4444" />
                        </BarChart>
                      </ResponsiveContainer>
                    </Card>
                    <Card className="p-4">
                      <h4 className="text-sm font-medium text-neutral-800 mb-3">Voice QA Snapshot</h4>
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <Metric label="Analyzed" value={voiceQaSummary.analyzed} />
                          <Metric label="Flags" value={voiceQaSummary.totalFlags} />
                          <Metric label="Action Items" value={voiceQaSummary.totalActionItems} />
                          <Metric label="Watch" value={voiceQaSummary.watch} />
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-neutral-200">
                                <th className="text-left py-2">Day</th>
                                <th className="text-right py-2">Analyzed</th>
                                <th className="text-right py-2">Flagged</th>
                                <th className="text-right py-2">Review</th>
                              </tr>
                            </thead>
                            <tbody>
                              {voiceQaSeries.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="py-3 text-neutral-500">
                                    No voice QA signals in range.
                                  </td>
                                </tr>
                              ) : (
                                [...voiceQaSeries].slice(-8).reverse().map((item) => (
                                  <tr key={item.date} className="border-b border-neutral-100">
                                    <td className="py-2">{new Date(item.date).toLocaleDateString()}</td>
                                    <td className="py-2 text-right">{item.analyzed}</td>
                                    <td className="py-2 text-right">{item.flagged}</td>
                                    <td className="py-2 text-right">{item.review}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </Card>
                  </div>
                </>
              ) : null}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="font-semibold mb-4">Ticket Volume</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => {
                        const parsed = new Date(date);
                        return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                      }}
                      stroke="#9ca3af"
                      fontSize={12}
                    />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Line type="monotone" dataKey="tickets" name="Created" stroke={COLORS.primary} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="resolved" name="Resolved" stroke={COLORS.success} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-4">Avg Response Time (min)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => {
                        const parsed = new Date(date);
                        return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                      }}
                      stroke="#9ca3af"
                      fontSize={12}
                    />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip />
                    <Line type="monotone" dataKey="avgResponseTime" name="Response Time" stroke={COLORS.secondary} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-4">Tickets by Channel</h3>
                <div className="flex items-center justify-between">
                  <ResponsiveContainer width="50%" height={250}>
                    <PieChart>
                      <Pie data={channelDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="count" paddingAngle={2}>
                        {channelDistribution.map((entry, index) => (
                          <Cell key={entry.channel} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-3 pl-4">
                    {channelDistribution.map((item, index) => (
                      <div key={item.channel} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                          <span className="text-sm text-neutral-700">{item.channel}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">{item.count}</p>
                          <p className="text-xs text-neutral-500">{item.percentage}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-4">Tickets by Priority</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={priorityBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="priority" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-4">Resolution SLA Trend Proxy</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => {
                        const parsed = new Date(date);
                        return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                      }}
                      stroke="#9ca3af"
                      fontSize={12}
                    />
                    <YAxis domain={[0, 5]} stroke="#9ca3af" fontSize={12} />
                    <Tooltip />
                    <Line type="monotone" dataKey="satisfaction" name="SLA Score" stroke={COLORS.success} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-4">Top Tags</h3>
                <div className="space-y-3">
                  {topTags.map((item) => {
                    const maxCount = topTags[0]?.count ?? 1;
                    const percentage = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
                    const tagHref = `/tickets?tag=${encodeURIComponent(item.tag)}`;
                    return (
                      <div key={item.tag}>
                        <div className="flex items-center justify-between mb-1">
                          <Link href={tagHref} className="text-sm text-blue-700 hover:underline underline-offset-4">
                            {item.tag}
                          </Link>
                          <span className="text-sm font-medium">{item.count}</span>
                        </div>
                        <div className="w-full bg-neutral-100 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-4">WhatsApp Delivery Trend</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={whatsAppStatusSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => {
                        const parsed = new Date(date);
                        return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                      }}
                      stroke="#9ca3af"
                      fontSize={12}
                    />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Line type="monotone" dataKey="sent" stroke={COLORS.primary} dot={false} />
                    <Line type="monotone" dataKey="delivered" stroke={COLORS.success} dot={false} />
                    <Line type="monotone" dataKey="read" stroke={COLORS.secondary} dot={false} />
                    <Line type="monotone" dataKey="failed" stroke="#ef4444" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-4">Voice Outcomes</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={voiceOutcomes}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => {
                        const parsed = new Date(date);
                        return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
                      }}
                      stroke="#9ca3af"
                      fontSize={12}
                    />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="completed" stackId="voice" fill={COLORS.success} />
                    <Bar dataKey="failed" stackId="voice" fill="#ef4444" />
                    <Bar dataKey="noAnswer" stackId="voice" fill="#f59e0b" />
                    <Bar dataKey="busy" stackId="voice" fill="#6366f1" />
                    <Bar dataKey="canceled" stackId="voice" fill={COLORS.neutral} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Agent Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-neutral-200">
                      <th className="text-left py-3 px-4 text-sm font-medium text-neutral-600">Agent</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-neutral-600">Tickets Handled</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-neutral-600">Avg Response (min)</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-neutral-600">Avg Resolution (hrs)</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-neutral-600">SLA Proxy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentPerformance.map((agent, index) => (
                      <tr key={agent.agent} className={cn("border-b border-neutral-100", index % 2 === 0 ? "bg-white" : "bg-neutral-50/50")}>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-medium">
                              {agent.agent.charAt(0)}
                            </div>
                            <span className="font-medium text-sm">{agent.agent}</span>
                          </div>
                        </td>
                        <td className="text-right py-3 px-4 text-sm">{agent.ticketsHandled}</td>
                        <td className="text-right py-3 px-4 text-sm">{agent.avgResponseTime.toFixed(1)}</td>
                        <td className="text-right py-3 px-4 text-sm">{agent.avgResolutionTime.toFixed(1)}</td>
                        <td className="text-right py-3 px-4">
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                            {agent.satisfaction.toFixed(1)}/5
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}

function KPICard({
  metric,
  formatValue
}: {
  metric: KpiMetric;
  formatValue: (metric: KpiMetric) => string;
}) {
  const isPositiveChange = metric.trend === "up";
  const isGoodChange =
    (metric.id.includes("response") || metric.id.includes("resolution")) ? metric.trend === "down" : metric.trend === "up";

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm text-neutral-600">{metric.label}</p>
        <div
          className={cn(
            "flex items-center gap-1 text-xs px-2 py-1 rounded-full",
            isGoodChange ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          )}
        >
          {isPositiveChange ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(metric.change).toFixed(1)}%
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <p className="text-3xl font-semibold">{formatValue(metric)}</p>
        {metric.unit ? <span className="text-sm text-neutral-500">{metric.unit}</span> : null}
      </div>
      <p className="text-xs text-neutral-500 mt-2">vs previous period</p>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <p className="text-xs text-neutral-600">{label}</p>
      <p className="mt-1 text-base font-semibold text-neutral-900">{value}</p>
    </div>
  );
}
