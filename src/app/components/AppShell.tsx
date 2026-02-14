"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import BrandMark from "@/app/components/BrandMark";

const NAV_ITEMS = [
  { label: "Support", href: "/tickets", icon: SupportIcon },
  { label: "Mail", href: "/mail", icon: MailIcon },
  { label: "Analytics", href: "/analytics", icon: AnalyticsIcon },
  { label: "Admin", href: "/admin", icon: AdminIcon }
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      const value = window.localStorage.getItem("sixesk:sidebarCollapsed");
      if (value === "1") {
        setSidebarCollapsed(true);
      }
    } catch {
      // Ignore localStorage access issues.
    }
  }, []);

  function isActive(href: string) {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("sixesk:sidebarCollapsed", next ? "1" : "0");
      } catch {
        // Ignore localStorage access issues.
      }
      return next;
    });
  }

  async function handleSignOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className={`app-sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="app-brand-row">
          <div className="app-brand">
            <BrandMark size={sidebarCollapsed ? 44 : 68} />
          </div>
          <button
            type="button"
            className="app-sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand" : "Collapse"}
          >
            <CollapseIcon collapsed={sidebarCollapsed} />
          </button>
        </div>
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`app-nav-link${isActive(item.href) ? " active" : ""}`}
              title={sidebarCollapsed ? item.label : undefined}
              aria-label={item.label}
            >
              <item.icon />
              <span className="app-nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="app-sidebar-footer">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="app-signout app-signout-sidebar"
            title={sidebarCollapsed ? "Sign out" : undefined}
            aria-label="Sign out"
          >
            <SignOutIcon />
            <span className="app-signout-label">{signingOut ? "Signing out..." : "Sign out"}</span>
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-header">
          <div className="app-header-title">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="app-header-actions">{actions}</div>
        </header>
        <div className="app-main">{children}</div>
      </div>
    </div>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={collapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SupportIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12a8 8 0 1 1 16 0v4a2 2 0 0 1-2 2h-2v-5h4M4 13h4v5H6a2 2 0 0 1-2-2v-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16v10H4V7Zm0 0 8 6 8-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AnalyticsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 18h16M7 16v-4M12 16V8M17 16v-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 6a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
