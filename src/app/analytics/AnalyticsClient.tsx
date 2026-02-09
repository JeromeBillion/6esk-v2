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

  const range = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - 7);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10)
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({
      start: range.start,
      end: range.end
    }).toString();

    async function load() {
      const [overviewRes, slaRes] = await Promise.all([
        fetch(`/api/analytics/overview?${params}`),
        fetch(`/api/analytics/sla?${params}`)
      ]);

      if (overviewRes.ok) {
        const payload = await overviewRes.json();
        setOverview(payload);
      }

      if (slaRes.ok) {
        const payload = await slaRes.json();
        setSla(payload);
      }
    }

    void load();
  }, [range]);

  return (
    <main>
      <div className="container">
        <h1>Analytics</h1>
        <p>Last 7 days overview.</p>

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
        </div>
      </div>
    </main>
  );
}
