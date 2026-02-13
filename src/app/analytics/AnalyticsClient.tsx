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

type WhatsAppStatusSeries = {
  sent: VolumePoint[];
  delivered: VolumePoint[];
  read: VolumePoint[];
  failed: VolumePoint[];
};

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
    whatsapp: WhatsAppStatusSeries;
  }>({
    created: [],
    solved: [],
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
  const whatsappOutbound = overview?.channels?.whatsapp.outbound ?? 0;
  const whatsappFailed = overview?.channels?.whatsapp.failed ?? 0;
  const whatsappDeliveryRate =
    whatsappOutbound > 0 ? Math.max(0, Math.round(((whatsappOutbound - whatsappFailed) / whatsappOutbound) * 100)) : null;

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

  useEffect(() => {
    const params = new URLSearchParams({
      start: range.start,
      end: range.end
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
  }, [range, agentFilter, tagFilter, priorityFilter]);

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
              Email {emailTotal} · WhatsApp {whatsappTotal}
            </h2>
            <p style={{ marginTop: 10, color: "var(--muted)" }}>
              WhatsApp outbound {whatsappOutbound} · failed {whatsappFailed} · delivery{" "}
              {whatsappDeliveryRate === null ? "—" : `${whatsappDeliveryRate}%`}
            </p>
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
            <h2>WhatsApp Delivery Trend</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {whatsappTrendRows.length === 0 ? (
                <p>No WhatsApp status events in this range.</p>
              ) : (
                whatsappTrendRows.map((row) => (
                  <div key={row.day} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{row.day.slice(0, 10)}</span>
                    <span>
                      Sent: {row.sent} · Delivered: {row.delivered} · Read: {row.read} · Failed:{" "}
                      {row.failed}
                    </span>
                  </div>
                ))
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
