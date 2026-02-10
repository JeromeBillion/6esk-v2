"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import BrandMark from "@/app/components/BrandMark";

const NAV_ITEMS = [
  { label: "Platform", href: "/tickets" },
  { label: "Mail", href: "/mail" },
  { label: "Analytics", href: "/analytics" },
  { label: "Admin", href: "/admin" }
];

type AppShellProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export default function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);

  function isActive(href: string) {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function handleSignOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <BrandMark size={36} />
          <div>
            <div className="app-brand-title">6esk</div>
            <div className="app-brand-sub">Support console</div>
          </div>
        </div>
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`app-nav-link${isActive(item.href) ? " active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="app-body">
        <header className="app-header">
          <div className="app-header-title">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="app-header-actions">
            {actions}
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="app-signout"
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </header>
        <div className="app-main">{children}</div>
      </div>
    </div>
  );
}
