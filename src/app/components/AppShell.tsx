"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, LogOut, Mail, Moon, Settings, Sun, Ticket } from "lucide-react";
import BrandMark from "@/app/components/BrandMark";
import { cn } from "@/app/workspace/components/ui/utils";
import { Button } from "@/app/workspace/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/workspace/components/ui/dialog";
import { useDemoMode } from "@/app/lib/demo-mode";
import { useThemeMode } from "@/app/lib/theme";

const NAVIGATION = [
  { name: "Support", href: "/tickets", icon: Ticket },
  { name: "Mail", href: "/mail", icon: Mail },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Admin", href: "/admin", icon: Settings },
] as const;

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { theme, toggleTheme } = useThemeMode();
  const { demoModeEnabled, setDemoModeEnabled } = useDemoMode();

  const activeRoute = useMemo(() => pathname ?? "", [pathname]);
  const nextThemeLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  async function handleSignOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
      <div className="h-screen flex bg-neutral-50">
        <div className="w-16 bg-white border-r border-neutral-200 flex flex-col items-center py-4 gap-2">
          <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
            <BrandMark size={32} priority />
          </div>
          <nav className="flex flex-col gap-1 w-full px-2">
            {NAVIGATION.map((item) => {
              const isActive =
                activeRoute === item.href ||
                activeRoute.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center justify-center h-12 rounded-lg transition-colors",
                    isActive ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
                  )}
                  title={item.name}
                >
                  <item.icon className="w-5 h-5" />
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto flex flex-col items-center gap-2 w-full px-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex flex-col items-center justify-center h-12 w-full rounded-lg transition-colors text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
              title={nextThemeLabel}
              aria-label={nextThemeLabel}
            >
              <ThemeIcon
                className={cn(
                  "h-5 w-5 transition-all duration-200",
                  theme === "dark" ? "rotate-0 scale-100" : "-rotate-12 scale-100"
                )}
              />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex flex-col items-center justify-center h-12 w-full rounded-lg transition-colors text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
              title="Settings"
              aria-label="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden" key={demoModeEnabled ? "sample-data" : "live-data"}>
          {children}
        </div>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between border border-neutral-200 rounded-lg p-4">
              <div>
                <p className="text-sm font-medium">Appearance</p>
                <p className="text-xs text-neutral-600">
                  Active theme: {theme === "dark" ? "Dark" : "Light"}.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={toggleTheme}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === "dark" ? "Light Mode" : "Dark Mode"}
              </Button>
            </div>

            <div className="flex items-center justify-between border border-neutral-200 rounded-lg p-4">
              <div>
                <p className="text-sm font-medium">Data Source</p>
                <p className="text-xs text-neutral-600">Use seeded sample data to review full UI permutations.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={demoModeEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDemoModeEnabled(true)}
                >
                  Sample Data
                </Button>
                <Button
                  type="button"
                  variant={!demoModeEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDemoModeEnabled(false)}
                >
                  Live Data
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between border border-neutral-200 rounded-lg p-4">
              <div>
                <p className="text-sm font-medium">Session</p>
                <p className="text-xs text-neutral-600">Sign out of the current workspace session.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                <LogOut className="h-4 w-4" />
                {signingOut ? "Signing out..." : "Sign Out"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
