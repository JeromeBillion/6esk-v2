"use client";

import { useEffect, useState } from "react";

type ProfileLookupMetricsPoint = {
  day: string;
  matched: number;
  matchedLive: number;
  matchedCache: number;
  matchedOther: number;
  missed: number;
  errored: number;
  disabled: number;
};

type ProfileLookupMetrics = {
  generatedAt: string;
  windowDays: number;
  configuredTimeoutMs: number;
  summary: {
    total: number;
    matched: number;
    matchedLive: number;
    matchedCache: number;
    matchedOther: number;
    missed: number;
    errored: number;
    disabled: number;
    timeoutErrors: number;
    hitRate: number;
    liveHitRate: number;
    cacheHitRate: number;
    fallbackHitRate: number;
    missRate: number;
    errorRate: number;
    timeoutErrorRate: number;
    avgDurationMs: number | null;
    p95DurationMs: number | null;
  };
  series: ProfileLookupMetricsPoint[];
};

export default function ProfileLookupClient({ compact = false }: { compact?: boolean }) {
  const [windowDays, setWindowDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<ProfileLookupMetrics | null>(null);

  async function loadMetrics(days: number) {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/admin/profile-lookup/metrics?days=${days}`);
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      setError(payload.error ?? "Failed to load profile lookup diagnostics.");
      setLoading(false);
      return;
    }
    const payload = (await res.json()) as ProfileLookupMetrics;
    setMetrics(payload);
    setLoading(false);
  }

  useEffect(() => {
    void loadMetrics(windowDays);
  }, [windowDays]);

  const series = metrics?.series ?? [];
  const maxSeriesValue = Math.max(
    1,
    ...series.map((point) => point.matched + point.missed + point.errored + point.disabled)
  );

  const summary = metrics?.summary ?? {
    total: 0,
    matched: 0,
    matchedLive: 0,
    matchedCache: 0,
    matchedOther: 0,
    missed: 0,
    errored: 0,
    disabled: 0,
    timeoutErrors: 0,
    hitRate: 0,
    liveHitRate: 0,
    cacheHitRate: 0,
    fallbackHitRate: 0,
    missRate: 0,
    errorRate: 0,
    timeoutErrorRate: 0,
    avgDurationMs: null,
    p95DurationMs: null
  };

  return (
    <section style={{ display: "grid", gap: 14 }}>
      {!compact ? <h2 style={{ marginBottom: 0 }}>Profile Lookup Diagnostics</h2> : null}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Window
          <select
            value={windowDays}
            onChange={(event) => setWindowDays(Number(event.target.value))}
            style={{ marginLeft: 8 }}
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void loadMetrics(windowDays)}
          disabled={loading}
          style={{
            padding: "7px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            color: "var(--text)",
            cursor: "pointer"
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
        {metrics ? (
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Updated {new Date(metrics.generatedAt).toLocaleTimeString()} · Timeout baseline{" "}
            {metrics.configuredTimeoutMs}ms
          </span>
        ) : null}
      </div>

      {error ? <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p> : null}

      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))"
        }}
      >
        <div className="panel" style={{ padding: 10 }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Total Lookups</div>
          <strong style={{ fontSize: 24 }}>{summary.total}</strong>
        </div>
        <div className="panel" style={{ padding: 10 }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Matched</div>
          <strong style={{ fontSize: 24 }}>{summary.matched}</strong>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {summary.hitRate}% hit rate · Live {summary.matchedLive} ({summary.liveHitRate}%)
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Cache {summary.matchedCache} ({summary.cacheHitRate}%) · Other {summary.matchedOther}
          </div>
        </div>
        <div className="panel" style={{ padding: 10 }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Fallback Recovered</div>
          <strong style={{ fontSize: 24 }}>{summary.matchedCache}</strong>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {summary.fallbackHitRate}% fallback hit rate
          </div>
        </div>
        <div className="panel" style={{ padding: 10 }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Missed</div>
          <strong style={{ fontSize: 24 }}>{summary.missed}</strong>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{summary.missRate}% miss rate</div>
        </div>
        <div className="panel" style={{ padding: 10 }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Errors</div>
          <strong style={{ fontSize: 24 }}>{summary.errored}</strong>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{summary.errorRate}% error rate</div>
        </div>
        <div className="panel" style={{ padding: 10 }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Timeout Errors</div>
          <strong style={{ fontSize: 24 }}>{summary.timeoutErrors}</strong>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {summary.timeoutErrorRate}% timeout rate
          </div>
        </div>
        <div className="panel" style={{ padding: 10 }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>Latency</div>
          <strong style={{ fontSize: 20 }}>
            {summary.avgDurationMs === null ? "-" : `${summary.avgDurationMs}ms`}
          </strong>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            p95 {summary.p95DurationMs === null ? "-" : `${summary.p95DurationMs}ms`}
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <strong>Daily Lookup Outcomes</strong>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>{windowDays} day window</span>
        </div>
        {series.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>No profile lookup activity in this window.</p>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))`,
                gap: 4,
                alignItems: "end",
                height: 130
              }}
            >
              {series.map((point) => {
                const disabledHeight = (point.disabled / maxSeriesValue) * 100;
                const erroredHeight = (point.errored / maxSeriesValue) * 100;
                const missedHeight = (point.missed / maxSeriesValue) * 100;
                const matchedOtherHeight = (point.matchedOther / maxSeriesValue) * 100;
                const matchedCacheHeight = (point.matchedCache / maxSeriesValue) * 100;
                const matchedLiveHeight = (point.matchedLive / maxSeriesValue) * 100;
                return (
                  <div
                    key={point.day}
                    title={`${point.day} | matched: ${point.matched} (live ${point.matchedLive}, cache ${point.matchedCache}, other ${point.matchedOther}), missed: ${point.missed}, errors: ${point.errored}, disabled: ${point.disabled}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      gap: 2,
                      height: "100%"
                    }}
                  >
                    <div
                      style={{
                        height: `${Math.max(0, disabledHeight)}%`,
                        minHeight: point.disabled ? 2 : 0,
                        borderRadius: 4,
                        background: "rgba(145, 145, 145, 0.9)"
                      }}
                    />
                    <div
                      style={{
                        height: `${Math.max(0, erroredHeight)}%`,
                        minHeight: point.errored ? 2 : 0,
                        borderRadius: 4,
                        background: "rgba(255, 112, 112, 0.9)"
                      }}
                    />
                    <div
                      style={{
                        height: `${Math.max(0, missedHeight)}%`,
                        minHeight: point.missed ? 2 : 0,
                        borderRadius: 4,
                        background: "rgba(255, 190, 99, 0.9)"
                      }}
                    />
                    <div
                      style={{
                        height: `${Math.max(0, matchedOtherHeight)}%`,
                        minHeight: point.matchedOther ? 2 : 0,
                        borderRadius: 4,
                        background: "rgba(123, 194, 255, 0.9)"
                      }}
                    />
                    <div
                      style={{
                        height: `${Math.max(0, matchedCacheHeight)}%`,
                        minHeight: point.matchedCache ? 2 : 0,
                        borderRadius: 4,
                        background: "rgba(92, 225, 230, 0.9)"
                      }}
                    />
                    <div
                      style={{
                        height: `${Math.max(0, matchedLiveHeight)}%`,
                        minHeight: point.matchedLive ? 2 : 0,
                        borderRadius: 4,
                        background: "rgba(104, 220, 160, 0.9)"
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
              <span>Green: Matched (Live)</span>
              <span>Cyan: Matched (Cache)</span>
              <span>Blue: Matched (Other)</span>
              <span>Amber: Missed</span>
              <span>Red: Error</span>
              <span>Gray: Disabled</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
