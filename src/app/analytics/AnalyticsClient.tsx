"use client";

import { useEffect, useMemo, useState } from "react";

type Overview = {
  totalTickets: number;
  openTickets: number;
  ticketsCreatedToday: number;
  ticketsSolvedToday: number;
  avgFirstResponseSeconds: number;
  avgResolutionSeconds: number;
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

type PerformanceRow = {
  key: string;
  label: string;
  total: number;
  open: number;
  solved: number;
  avg_first_response_seconds: number | null;
  avg_resolution_seconds: number | null;
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
  const [volume, setVolume] = useState<{ created: VolumePoint[]; solved: VolumePoint[] }>({
    created: [],
    solved: []
  });
  const [performanceAgent, setPerformanceAgent] = useState<PerformanceRow[]>([]);
  const [performanceTag, setPerformanceTag] = useState<PerformanceRow[]>([]);
  const [performancePriority, setPerformancePriority] = useState<PerformanceRow[]>([]);

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

  useEffect(() => {
    const params = new URLSearchParams({
      start: range.start,
      end: range.end
    }).toString();

    async function load() {
      const [overviewRes, slaRes, volumeRes, agentRes, tagRes, priorityRes] = await Promise.all([
        fetch(`/api/analytics/overview?${params}`),
        fetch(`/api/analytics/sla?${params}`),
        fetch(`/api/analytics/volume?${params}`),
        fetch(`/api/analytics/performance?${params}&groupBy=agent`),
        fetch(`/api/analytics/performance?${params}&groupBy=tag`),
        fetch(`/api/analytics/performance?${params}&groupBy=priority`)
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
          solved: payload.solved ?? []
        });
      }

      if (agentRes.ok) {
        const payload = await agentRes.json();
        setPerformanceAgent(payload.rows ?? []);
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
  }, [range]);

  return (
    <main>
      <div className="container">
        <h1>Analytics</h1>
        <p>Track ticket performance and SLA health.</p>

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
            <h2>Performance by Agent</h2>
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
            <h2>Performance by Tag</h2>
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
            <h2>Performance by Priority</h2>
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
    </main>
  );
}
