import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/app/workspace/components/ui/utils";

type HealthIndicatorProps = {
  healthy: boolean;
  message?: string;
  severity?: "info" | "warning" | "error";
  size?: "sm" | "md";
  className?: string;
};

export function HealthIndicator({
  healthy,
  message,
  severity = "info",
  size = "md",
  className
}: HealthIndicatorProps) {
  const Icon = healthy ? CheckCircle : severity === "error" ? AlertCircle : AlertTriangle;

  const colorClasses = healthy
    ? "text-green-700 bg-green-50 border-green-200"
    : severity === "error"
      ? "text-red-700 bg-red-50 border-red-200"
      : "text-amber-700 bg-amber-50 border-amber-200";

  const sizeClasses = size === "sm" ? "text-xs p-2" : "text-sm p-3";

  return (
    <div className={cn("flex items-start gap-2 rounded-lg border", colorClasses, sizeClasses, className)}>
      <Icon className={cn("mt-0.5 shrink-0", size === "sm" ? "h-4 w-4" : "h-5 w-5")} />
      {message ? <span className="flex-1">{message}</span> : null}
    </div>
  );
}
