import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/app/workspace/components/ui/utils";

type MetricCardProps = {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  trendTone?: "positive" | "negative" | "neutral";
  status?: "healthy" | "warning" | "critical";
  sparkline?: number[];
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function MetricCard({
  label,
  value,
  unit,
  trend,
  trendValue,
  trendTone = "neutral",
  status = "healthy",
  sparkline,
  size = "md",
  className
}: MetricCardProps) {
  const statusClasses = {
    healthy: "border-green-200/80 bg-green-50/40",
    warning: "border-amber-200/80 bg-amber-50/50",
    critical: "border-red-200/80 bg-red-50/50"
  } as const;

  const trendClasses = {
    positive: "text-green-700 bg-green-100",
    negative: "text-red-700 bg-red-100",
    neutral: "text-neutral-600 bg-neutral-100"
  } as const;

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  const sizeClasses = {
    sm: { card: "p-3", value: "text-2xl", label: "text-[11px]" },
    md: { card: "p-4", value: "text-3xl", label: "text-xs" },
    lg: { card: "p-5", value: "text-4xl", label: "text-sm" }
  } as const;

  return (
    <div className={cn("rounded-xl border bg-white", statusClasses[status], sizeClasses[size].card, className)}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className={cn("font-medium uppercase tracking-[0.12em] text-neutral-500", sizeClasses[size].label)}>
          {label}
        </p>
        {trend && trendValue ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              trendClasses[trendTone]
            )}
          >
            <TrendIcon className="h-3 w-3" />
            {trendValue}
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-1.5">
        <p className={cn("font-semibold text-neutral-900", sizeClasses[size].value)}>{value}</p>
        {unit ? <span className="text-sm font-medium text-neutral-500">{unit}</span> : null}
      </div>
      {sparkline && sparkline.length > 0 ? (
        <div className="mt-3">
          <Sparkline data={sparkline} />
        </div>
      ) : null}
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) {
    return null;
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="h-8 w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500" />
    </svg>
  );
}
