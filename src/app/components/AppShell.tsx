"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, LogOut, Mail, Moon, Settings, Sun, Ticket } from "lucide-react";
import { cn } from "@/app/workspace/components/ui/utils";
import { Button } from "@/app/workspace/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/workspace/components/ui/dialog";
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
  const { theme, setThemeMode } = useThemeMode();

  const activeRoute = useMemo(() => pathname ?? "", [pathname]);

  async function handleSignOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <>
      <div className="h-screen flex bg-neutral-50">
        <div className="w-16 bg-white border-r border-neutral-200 flex flex-col items-center py-4 gap-2">
          <div className="mb-6 w-10 h-10 rounded-lg bg-neutral-900 flex items-center justify-center text-white font-semibold text-sm">
            6E
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
              onClick={() => setSettingsOpen(true)}
              className="flex flex-col items-center justify-center h-12 w-full rounded-lg transition-colors text-neutral-600 hover:bg-neutral-100"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="flex flex-col items-center justify-center h-12 w-full rounded-lg transition-colors text-neutral-600 hover:bg-neutral-100 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Sign out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">{children}</div>
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
                <p className="text-xs text-neutral-600">Switch between light and dark mode.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={theme === "light" ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => setThemeMode("light")}
                >
                  <Sun className="w-4 h-4" />
                  Light
                </Button>
                <Button
                  type="button"
                  variant={theme === "dark" ? "default" : "outline"}
                  size="sm"
                  className="gap-1"
                  onClick={() => setThemeMode("dark")}
                >
                  <Moon className="w-4 h-4" />
                  Dark
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
