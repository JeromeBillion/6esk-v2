import { cn } from "@/app/workspace/components/ui/utils";

type StatusBadgeProps = {
  status: "active" | "paused" | "failed" | "pending" | "inactive";
  label?: string;
  size?: "sm" | "md";
  className?: string;
};

export function StatusBadge({ status, label, size = "sm", className }: StatusBadgeProps) {
  const statusConfig = {
    active: { color: "bg-green-100 text-green-700 border-green-200", dot: "bg-green-500", text: "Active" },
    paused: { color: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500", text: "Paused" },
    failed: { color: "bg-red-100 text-red-700 border-red-200", dot: "bg-red-500", text: "Failed" },
    pending: { color: "bg-blue-100 text-blue-700 border-blue-200", dot: "bg-blue-500", text: "Pending" },
    inactive: { color: "bg-neutral-100 text-neutral-600 border-neutral-200", dot: "bg-neutral-400", text: "Inactive" }
  } as const;

  const config = statusConfig[status];
  const displayLabel = label || config.text;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        config.color,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {displayLabel}
    </span>
  );
}
