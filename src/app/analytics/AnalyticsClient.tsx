"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/app/components/AppShell";

type Overview = {
  totalTickets: number;
  openTickets: number;
  ticketsCreatedToday: number;
  ticketsSolvedToday: number;
  avgFirstResponseSeconds: number;
  avgResolutionSeconds: number;
  channels?: {
    email: {
      inbound: number;
      outbound: number;
    };
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
      topFailureReasons: Array<{ reason: string; count: number }>;
    };
  };
};

type Sla = {
  targets: {
    firstResponseMinutes: number;
    resolutionMinutes: number;
  };
  firstResponse: {
    total: number;
    compliant: number;
    complianceRate: number;
  };
  resolution: {
    total: number;
    compliant: number;
    complianceRate: number;
  };
};

type VolumePoint = {
  day: string;
  count: number;
};

type VoiceVolumePoint = {
  day: string;
  inbound: number;
  outbound: number;
  completed: number;
  failed: number;
  noAnswer: number;
  busy: number;
  canceled: number;
  avgDurationSeconds: number;
};

type WhatsAppStatusSeries = {
  sent: VolumePoint[];
  delivered: VolumePoint[];
  read: VolumePoint[];
  failed: VolumePoint[];
};

type WhatsAppStatusKey = "sent" | "delivered" | "read" | "failed";

const WHATSAPP_STATUS_META: Array<{ key: WhatsAppStatusKey; label: string; color: string }> = [
  { key: "sent", label: "Sent", color: "#6ab8ff" },
  { key: "delivered", label: "Delivered", color: "#7ff5a2" },
  { key: "read", label: "Read", color: "#ffd166" },
  { key: "failed", label: "Failed", color: "#ff6b6b" }
];

type PerformanceRow = {
  key: string;
  label: string;
  total: number;
  open: number;
  solved: number;
  avg_first_response_seconds: number | null;
  avg_resolution_seconds: number | null;
};

type AgentOption = {
  id: string;
  label: string;
};

const toHuman = (seconds: number) => {
  if (!seconds || Number.isNaN(seconds)) {
    return "—";
  }
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return `${hours}h`;
};

export default function AnalyticsClient() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sla, setSla] = useState<Sla | null>(null);
  const [volume, setVolume] = useState<{
    created: VolumePoint[];
    solved: VolumePoint[];
    voice: VoiceVolumePoint[];
    whatsappSource: "all" | "webhook" | "outbox";
    whatsapp: WhatsAppStatusSeries;
  }>({
    created: [],
    solved: [],
    voice: [],
    whatsappSource: "all",
    whatsapp: {
      sent: [],
      delivered: [],
      read: [],
      failed: []
    }
  });
  const [performanceAgent, setPerformanceAgent] = useState<PerformanceRow[]>([]);
  const [performanceTag, setPerformanceTag] = useState<PerformanceRow[]>([]);
  const [performancePriority, setPerformancePriority] = useState<PerformanceRow[]>([]);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [whatsappSourceFilter, setWhatsappSourceFilter] = useState<"all" | "webhook" | "outbox">("all");
  const [whatsappStatusFilter, setWhatsappStatusFilter] = useState<Record<WhatsAppStatusKey, boolean>>({
    sent: true,
    delivered: true,
    read: true,
    failed: true
  });
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);

  const exportCsv = (rows: PerformanceRow[], filename: string) => {
    const headers = [
      "label",
      "total",
      "open",
      "solved",
      "avg_first_response_seconds",
      "avg_resolution_seconds"
    ];
    const lines = [
      headers.join(","),
      ...rows.map((row) =>
        [
          `"${row.label.replace(/\"/g, '""')}"`,
          row.total,
          row.open,
          row.solved,
          row.avg_first_response_seconds ?? "",
          row.avg_resolution_seconds ?? ""
        ].join(",")
      )
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const [startDate, setStartDate] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - 7);
    return start.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const range = useMemo(() => {
    return { start: startDate, end: endDate };
  }, [startDate, endDate]);

  const emailTotal =
    (overview?.channels?.email.inbound ?? 0) + (overview?.channels?.email.outbound ?? 0);
  const whatsappTotal =
    (overview?.channels?.whatsapp.inbound ?? 0) + (overview?.channels?.whatsapp.outbound ?? 0);
  const voiceTotal =
    (overview?.channels?.voice.inbound ?? 0) + (overview?.channels?.voice.outbound ?? 0);
  const whatsappOutbound = overview?.channels?.whatsapp.outbound ?? 0;
  const whatsappFailed = overview?.channels?.whatsapp.failed ?? 0;
  const voiceOutbound = overview?.channels?.voice.outbound ?? 0;
  const voiceCompleted = overview?.channels?.voice.completed ?? 0;
  const voiceFailed = overview?.channels?.voice.failed ?? 0;
  const voiceNoAnswer = overview?.channels?.voice.noAnswer ?? 0;
  const voiceBusy = overview?.channels?.voice.busy ?? 0;
  const voiceCanceled = overview?.channels?.voice.canceled ?? 0;
  const voiceAvgDuration = overview?.channels?.voice.avgDurationSeconds ?? 0;
  const whatsappDeliveryRate =
    whatsappOutbound > 0 ? Math.max(0, Math.round(((whatsappOutbound - whatsappFailed) / whatsappOutbound) * 100)) : null;
  const voiceConnectRate =
    voiceOutbound > 0 ? Math.max(0, Math.round((voiceCompleted / voiceOutbound) * 100)) : null;
  const mergeFailureTop = overview?.merges?.reviews?.topFailureReasons ?? [];

  const whatsappTrendRows = useMemo(() => {
    const map = new Map<
      string,
      { day: string; sent: number; delivered: number; read: number; failed: number }
    >();

    const ensure = (day: string) => {
      const existing = map.get(day);
      if (existing) return existing;
      const next = { day, sent: 0, delivered: 0, read: 0, failed: 0 };
      map.set(day, next);
      return next;
    };

    for (const row of volume.whatsapp.sent) {
      ensure(row.day).sent = row.count;
    }
    for (const row of volume.whatsapp.delivered) {
      ensure(row.day).delivered = row.count;
    }
    for (const row of volume.whatsapp.read) {
      ensure(row.day).read = row.count;
    }
    for (const row of volume.whatsapp.failed) {
      ensure(row.day).failed = row.count;
    }

    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [volume.whatsapp.delivered, volume.whatsapp.failed, volume.whatsapp.read, volume.whatsapp.sent]);

  const activeWhatsAppStatuses = useMemo(
    () => WHATSAPP_STATUS_META.filter((status) => whatsappStatusFilter[status.key]),
    [whatsappStatusFilter]
  );

  const whatsappChart = useMemo(() => {
    if (whatsappTrendRows.length === 0 || activeWhatsAppStatuses.length === 0) {
      return null;
    }

    const width = 760;
    const height = 190;
    const padding = { top: 14, right: 14, bottom: 22, left: 14 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const maxValue = Math.max(
      1,
      ...activeWhatsAppStatuses.flatMap((status) =>
        whatsappTrendRows.map((row) => row[status.key])
      )
    );

    const toPoint = (index: number, value: number) => {
      const x =
        whatsappTrendRows.length === 1
          ? padding.left + innerWidth / 2
          : padding.left + (index / (whatsappTrendRows.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - (value / maxValue) * innerHeight;
      return { x, y };
    };

    const lines = activeWhatsAppStatuses.map((status) => {
      const points = whatsappTrendRows.map((row, index) => toPoint(index, row[status.key]));
      const path = points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(" ");
      return {
        key: status.key,
        label: status.label,
        color: status.color,
        path,
        lastPoint: points[points.length - 1]
      };
    });

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
      y: padding.top + innerHeight - ratio * innerHeight,
      value: Math.round(maxValue * ratio)
    }));

    return {
      width,
      height,
      maxValue,
      firstDay: whatsappTrendRows[0].day.slice(0, 10),
      lastDay: whatsappTrendRows[whatsappTrendRows.length - 1].day.slice(0, 10),
      lines,
      gridLines
    };
  }, [activeWhatsAppStatuses, whatsappTrendRows]);

  function toggleWhatsAppStatus(statusKey: WhatsAppStatusKey) {
    setWhatsappStatusFilter((prev) => ({
      ...prev,
      [statusKey]: !prev[statusKey]
    }));
  }

  useEffect(() => {
    const params = new URLSearchParams({
      start: range.start,
      end: range.end,
      whatsappSource: whatsappSourceFilter
    }).toString();

    async function load() {
      const filterParams = new URLSearchParams({
        ...(agentFilter !== "all" ? { agentId: agentFilter } : {}),
        ...(tagFilter !== "all" ? { tag: tagFilter } : {}),
        ...(priorityFilter !== "all" ? { priority: priorityFilter } : {})
      });
      const filterQuery = filterParams.toString();

      const [overviewRes, slaRes, volumeRes, agentRes, tagRes, priorityRes] = await Promise.all([
        fetch(`/api/analytics/overview?${params}`),
        fetch(`/api/analytics/sla?${params}`),
        fetch(`/api/analytics/volume?${params}`),
        fetch(`/api/analytics/performance?${params}&groupBy=agent&${filterQuery}`),
        fetch(`/api/analytics/performance?${params}&groupBy=tag&${filterQuery}`),
        fetch(`/api/analytics/performance?${params}&groupBy=priority&${filterQuery}`)
      ]);

      if (overviewRes.ok) {
        const payload = await overviewRes.json();
        setOverview(payload);
      }

      if (slaRes.ok) {
        const payload = await slaRes.json();
        setSla(payload);
      }

      if (volumeRes.ok) {
        const payload = await volumeRes.json();
        setVolume({
          created: payload.created ?? [],
          solved: payload.solved ?? [],
          voice: payload.voice ?? [],
          whatsappSource: payload.whatsappSource ?? whatsappSourceFilter,
          whatsapp: {
            sent: payload.whatsapp?.sent ?? [],
            delivered: payload.whatsapp?.delivered ?? [],
            read: payload.whatsapp?.read ?? [],
            failed: payload.whatsapp?.failed ?? []
          }
        });
      }

      if (agentRes.ok) {
        const payload = await agentRes.json();
        setPerformanceAgent(payload.rows ?? []);
        setAgentOptions(
          (payload.rows ?? []).map((row: PerformanceRow) => ({
            id: row.key,
            label: row.label
          }))
        );
      }

      if (tagRes.ok) {
        const payload = await tagRes.json();
        setPerformanceTag(payload.rows ?? []);
      }

      if (priorityRes.ok) {
        const payload = await priorityRes.json();
        setPerformancePriority(payload.rows ?? []);
      }
    }

    void load();
  }, [range, agentFilter, tagFilter, priorityFilter, whatsappSourceFilter]);

  return (
    <AppShell title="Analytics" subtitle="Track ticket performance and SLA health.">
      <div className="app-content">
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 16,
            alignItems: "center"
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            Start date
            <input
              type="date"
              value={range.start}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            End date
            <input
              type="date"
              value={range.end}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            Agent
            <select
              value={agentFilter}
              onChange={(event) => setAgentFilter(event.target.value)}
            >
              <option value="all">All</option>
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            Tag
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="all">All</option>
              {performanceTag.map((tag) => (
                <option key={tag.key} value={tag.key}>
                  {tag.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            Priority
            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
            >
              <option value="all">All</option>
              {performancePriority.map((priority) => (
                <option key={priority.key} value={priority.key}>
                  {priority.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            marginTop: 24
          }}
        >
          {[
            { label: "Total tickets", value: overview?.totalTickets },
            { label: "Open tickets", value: overview?.openTickets },
            { label: "Tickets created today", value: overview?.ticketsCreatedToday },
            { label: "Tickets solved today", value: overview?.ticketsSolvedToday }
          ].map((card) => (
            <div
              key={card.label}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                background: "rgba(10, 12, 18, 0.6)"
              }}
            >
              <p style={{ marginBottom: 8 }}>{card.label}</p>
              <h2 style={{ margin: 0 }}>{card.value ?? "—"}</h2>
            </div>
          ))}
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <p style={{ marginBottom: 8 }}>Channel mix</p>
            <h2 style={{ margin: 0 }}>
              Email {emailTotal} · WhatsApp {whatsappTotal} · Voice {voiceTotal}
            </h2>
            <p style={{ marginTop: 10, color: "var(--muted)" }}>
              WhatsApp outbound {whatsappOutbound} · failed {whatsappFailed} · delivery{" "}
              {whatsappDeliveryRate === null ? "—" : `${whatsappDeliveryRate}%`}
            </p>
            <p style={{ marginTop: 6, color: "var(--muted)" }}>
              Voice outbound {voiceOutbound} · completed {voiceCompleted} · failed {voiceFailed} ·
              no answer {voiceNoAnswer} · busy {voiceBusy} · canceled {voiceCanceled} · connect{" "}
              {voiceConnectRate === null ? "—" : `${voiceConnectRate}%`} · avg duration{" "}
              {voiceAvgDuration > 0 ? `${Math.round(voiceAvgDuration)}s` : "—"}
            </p>
          </div>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <p style={{ marginBottom: 8 }}>Merge operations</p>
            <h2 style={{ margin: 0 }}>
              Ticket {overview?.merges?.ticketMerges ?? 0} · Customer {overview?.merges?.customerMerges ?? 0}
            </h2>
            <p style={{ marginTop: 10, color: "var(--muted)" }}>
              AI {overview?.merges?.actorSplit.aiInitiated ?? 0} · Human{" "}
              {overview?.merges?.actorSplit.humanInitiated ?? 0} · Pending review{" "}
              {overview?.merges?.reviews.pending ?? 0}
            </p>
            <p style={{ marginTop: 6, color: "var(--muted)" }}>
              Rejected {overview?.merges?.reviews.rejectedInRange ?? 0} · Failed{" "}
              {overview?.merges?.reviews.failedInRange ?? 0}
            </p>
            {mergeFailureTop.length ? (
              <p style={{ marginTop: 6, color: "var(--muted)", fontSize: 12 }}>
                Top failure:{" "}
                {mergeFailureTop
                  .slice(0, 2)
                  .map((item) => `${item.reason} (${item.count})`)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        </div>

        <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <h2>Response & Resolution</h2>
            <p>Average first response time: {toHuman(overview?.avgFirstResponseSeconds ?? 0)}</p>
            <p>Average resolution time: {toHuman(overview?.avgResolutionSeconds ?? 0)}</p>
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <h2>SLA Lite</h2>
            <p>
              First response target: {sla?.targets.firstResponseMinutes ?? "—"} minutes
            </p>
            <p>
              Resolution target: {sla?.targets.resolutionMinutes ?? "—"} minutes
            </p>
            <p>
              First response compliance:{" "}
              {sla ? Math.round(sla.firstResponse.complianceRate * 100) : 0}%
            </p>
            <p>
              Resolution compliance: {sla ? Math.round(sla.resolution.complianceRate * 100) : 0}%
            </p>
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <h2>Ticket Volume</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {volume.created.length === 0 ? (
                <p>No volume data yet.</p>
              ) : (
                volume.created.map((row) => {
                  const solvedRow = volume.solved.find((item) => item.day === row.day);
                  return (
                    <div key={row.day} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{row.day.slice(0, 10)}</span>
                      <span>
                        Created: {row.count} / Solved: {solvedRow?.count ?? 0}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <h2>Voice KPI Summary</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 12 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "rgba(255, 192, 96, 0.1)",
                  border: "1px solid rgba(255, 192, 96, 0.2)"
                }}
              >
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Total Calls</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#ffd29d" }}>
                  {voiceTotal}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                  Inbound: {overview?.channels?.voice.inbound ?? 0} · Outbound: {voiceOutbound}
                </div>
              </div>

              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "rgba(127, 245, 162, 0.1)",
                  border: "1px solid rgba(127, 245, 162, 0.2)"
                }}
              >
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Success Rate</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#7ff5a2" }}>
                  {voiceConnectRate === null ? "—" : `${voiceConnectRate}%`}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                  {voiceCompleted} completed of {voiceOutbound} outbound
                </div>
              </div>

              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "rgba(135, 206, 235, 0.1)",
                  border: "1px solid rgba(135, 206, 235, 0.2)"
                }}
              >
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Avg Duration</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#87ceeb" }}>
                  {voiceAvgDuration > 0 ? `${Math.round(voiceAvgDuration)}s` : "—"}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                  Per completed call
                </div>
              </div>

              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "rgba(255, 107, 107, 0.1)",
                  border: "1px solid rgba(255, 107, 107, 0.2)"
                }}
              >
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Issues</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: "#ff6b6b" }}>
                  {voiceFailed + voiceNoAnswer + voiceBusy + voiceCanceled}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                  Failed: {voiceFailed} · No answer: {voiceNoAnswer} · Busy: {voiceBusy}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <h2 style={{ margin: 0 }}>Voice Outcomes</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {volume.voice.length === 0 ? (
                <p>No voice call data yet.</p>
              ) : (
                volume.voice.map((row) => {
                  const connectRate =
                    row.outbound > 0 ? Math.round((row.completed / row.outbound) * 100) : null;
                  return (
                    <div key={row.day} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{row.day.slice(0, 10)}</span>
                      <span>
                        In {row.inbound} · Out {row.outbound} · Completed {row.completed} · Failed{" "}
                        {row.failed} · No answer {row.noAnswer} · Busy {row.busy} · Canceled{" "}
                        {row.canceled} · Connect {connectRate === null ? "—" : `${connectRate}%`} ·
                        Avg {row.avgDurationSeconds > 0 ? `${Math.round(row.avgDurationSeconds)}s` : "—"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0 }}>WhatsApp Delivery Trend</h2>
              <label style={{ display: "grid", gap: 6 }}>
                Source
                <select
                  value={whatsappSourceFilter}
                  onChange={(event) =>
                    setWhatsappSourceFilter(event.target.value as "all" | "webhook" | "outbox")
                  }
                >
                  <option value="all">All sources</option>
                  <option value="webhook">Webhook</option>
                  <option value="outbox">Outbox</option>
                </select>
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {WHATSAPP_STATUS_META.map((status) => {
                const isActive = whatsappStatusFilter[status.key];
                return (
                  <button
                    key={status.key}
                    type="button"
                    onClick={() => toggleWhatsAppStatus(status.key)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: `1px solid ${isActive ? status.color : "var(--border)"}`,
                      background: isActive ? "rgba(10, 12, 18, 0.9)" : "transparent",
                      color: isActive ? status.color : "var(--muted)",
                      cursor: "pointer"
                    }}
                  >
                    {status.label}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 12 }}>
              {whatsappTrendRows.length === 0 ? (
                <p>
                  No WhatsApp status events in this range for source{" "}
                  <strong>{volume.whatsappSource}</strong>.
                </p>
              ) : !whatsappChart ? (
                <p>Select at least one status to render the chart.</p>
              ) : (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 10,
                    background: "rgba(6, 8, 12, 0.8)"
                  }}
                >
                  <svg
                    viewBox={`0 0 ${whatsappChart.width} ${whatsappChart.height}`}
                    role="img"
                    aria-label="WhatsApp status trend chart"
                    style={{ width: "100%", height: 170, display: "block" }}
                  >
                    {whatsappChart.gridLines.map((line) => (
                      <g key={`grid-${line.y}`}>
                        <line
                          x1={14}
                          y1={line.y}
                          x2={whatsappChart.width - 14}
                          y2={line.y}
                          stroke="rgba(255,255,255,0.12)"
                          strokeWidth={1}
                        />
                      </g>
                    ))}
                    {whatsappChart.lines.map((line) => (
                      <g key={line.key}>
                        <path
                          d={line.path}
                          fill="none"
                          stroke={line.color}
                          strokeWidth={2.4}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle cx={line.lastPoint.x} cy={line.lastPoint.y} r={3} fill={line.color} />
                      </g>
                    ))}
                  </svg>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      marginTop: 8,
                      fontSize: 12,
                      color: "var(--muted)"
                    }}
                  >
                    <span>{whatsappChart.firstDay}</span>
                    <span>Max {whatsappChart.maxValue}</span>
                    <span>{whatsappChart.lastDay}</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
              {WHATSAPP_STATUS_META.filter((status) => whatsappStatusFilter[status.key]).map(
                (status) => {
                  const latest =
                    whatsappTrendRows.length > 0
                      ? whatsappTrendRows[whatsappTrendRows.length - 1][status.key]
                      : 0;
                  return (
                    <span key={status.key} style={{ fontSize: 12, color: status.color }}>
                      {status.label}: {latest}
                    </span>
                  );
                }
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h2>Performance by Agent</h2>
              <button
                type="button"
                onClick={() => exportCsv(performanceAgent, "performance-by-agent.csv")}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  cursor: "pointer",
                  height: 32
                }}
              >
                Export CSV
              </button>
            </div>
            {performanceAgent.length === 0 ? (
              <p>No data yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {performanceAgent.map((row) => (
                  <div key={row.key} style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong>{row.label}</strong>
                    <span>
                      Total {row.total} · Open {row.open} · Solved {row.solved} · First resp{" "}
                      {toHuman(row.avg_first_response_seconds ?? 0)} · Resolution{" "}
                      {toHuman(row.avg_resolution_seconds ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h2>Performance by Tag</h2>
              <button
                type="button"
                onClick={() => exportCsv(performanceTag, "performance-by-tag.csv")}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  cursor: "pointer",
                  height: 32
                }}
              >
                Export CSV
              </button>
            </div>
            {performanceTag.length === 0 ? (
              <p>No data yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {performanceTag.map((row) => (
                  <div key={row.key} style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong>{row.label}</strong>
                    <span>
                      Total {row.total} · Open {row.open} · Solved {row.solved} · First resp{" "}
                      {toHuman(row.avg_first_response_seconds ?? 0)} · Resolution{" "}
                      {toHuman(row.avg_resolution_seconds ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
              background: "rgba(10, 12, 18, 0.6)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h2>Performance by Priority</h2>
              <button
                type="button"
                onClick={() => exportCsv(performancePriority, "performance-by-priority.csv")}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  cursor: "pointer",
                  height: 32
                }}
              >
                Export CSV
              </button>
            </div>
            {performancePriority.length === 0 ? (
              <p>No data yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {performancePriority.map((row) => (
                  <div key={row.key} style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong>{row.label}</strong>
                    <span>
                      Total {row.total} · Open {row.open} · Solved {row.solved} · First resp{" "}
                      {toHuman(row.avg_first_response_seconds ?? 0)} · Resolution{" "}
                      {toHuman(row.avg_resolution_seconds ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
