import type { ComponentPropsWithoutRef, ReactNode } from "react";

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function WorkBadge({
  children,
  tone = "neutral"
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger" | "info";
}) {
  const tones = {
    neutral: "border-white/10 bg-white/[0.06] text-zinc-300",
    good: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    warn: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    danger: "border-rose-400/25 bg-rose-400/10 text-rose-200",
    info: "border-sky-400/25 bg-sky-400/10 text-sky-200"
  };
  return (
    <span className={joinClasses("inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function WorkPanel({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={joinClasses(
        "rounded-2xl border border-white/10 bg-zinc-950/70 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)]",
        className
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function WorkMetric({
  label,
  value,
  detail
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">{label}</p>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {detail ? <p className="mt-1 text-sm text-zinc-400">{detail}</p> : null}
    </div>
  );
}
