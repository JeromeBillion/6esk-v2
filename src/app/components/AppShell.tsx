"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { BarChart3, Info, LogIn, LogOut, Mail, Moon, Settings, Sun, Ticket } from "lucide-react";
import BrandMark from "@/app/components/BrandMark";
import { cn } from "@/app/workspace/components/ui/utils";
import { Button } from "@/app/workspace/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/workspace/components/ui/dialog";
import { useDemoMode } from "@/app/lib/demo-mode";
import { parseDemoQueryValue } from "@/app/lib/demo-mode-config";
import { getCurrentSessionUser, type CurrentSessionUser } from "@/app/lib/api/session";
import { useThemeMode } from "@/app/lib/theme";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"]
});

const NAVIGATION = [
  { name: "Support", href: "/tickets", icon: Ticket },
  { name: "Mail", href: "/mail", icon: Mail },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Admin", href: "/admin", icon: Settings },
] as const;

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentSessionUser | null>(null);
  const { theme, toggleTheme } = useThemeMode();
  const { demoModeEnabled, setDemoModeEnabled } = useDemoMode();

  const activeRoute = useMemo(() => pathname ?? "", [pathname]);
  const demoQueryValue = searchParams.get("demo");
  const nextThemeLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  const buildWorkspaceHref = useMemo(() => {
    return (href: string, demoEnabled: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (demoEnabled) {
        params.set("demo", "1");
      } else {
        params.delete("demo");
      }
      const queryString = params.toString();
      return queryString ? `${href}?${queryString}` : href;
    };
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    void getCurrentSessionUser()
      .then((user) => {
        if (!cancelled) {
          setCurrentUser(user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentUser(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const requestedDemoMode = parseDemoQueryValue(searchParams.get("demo"));
    if (typeof requestedDemoMode === "boolean") {
      setDemoModeEnabled(requestedDemoMode);
    }
  }, [searchParams, setDemoModeEnabled]);

  async function handleSignOut() {
    setSigningOut(true);
    setDemoModeEnabled(false);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function handleSignIn() {
    setDemoModeEnabled(false);
    window.location.href = "/login";
  }

  function handleSampleDataRequest() {
    setDemoModeEnabled(true);
    setSettingsOpen(false);
    router.push(buildWorkspaceHref(activeRoute || "/tickets", true));
  }

  function handleLiveDataRequest() {
    if (currentUser) {
      setDemoModeEnabled(false);
      setSettingsOpen(false);
      router.push(buildWorkspaceHref(activeRoute || "/tickets", false));
      return;
    }
    handleSignIn();
  }

  return (
    <>
      <div className={cn(inter.className, "h-screen flex bg-neutral-50 dark:bg-neutral-950")}>
        <div className="w-16 bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800 flex flex-col items-center py-4 gap-2">
          <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:shadow-[0_12px_30px_rgba(0,0,0,0.28)]">
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
                  href={buildWorkspaceHref(item.href, demoModeEnabled)}
                  className={cn(
                    "mx-auto flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                    isActive
                      ? "bg-neutral-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)] dark:bg-white dark:text-neutral-950 dark:shadow-[0_10px_24px_rgba(255,255,255,0.08)]"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
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
              title="Info"
              aria-label="Info"
            >
              <Info className="w-5 h-5" />
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
            <DialogTitle>Info</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
                  onClick={handleSampleDataRequest}
                >
                  Sample Data
                </Button>
                <Button
                  type="button"
                  variant={!demoModeEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={handleLiveDataRequest}
                >
                  Live Data
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between border border-neutral-200 rounded-lg p-4">
              <div>
                <p className="text-sm font-medium">Session</p>
                <p className="text-xs text-neutral-600">
                  {currentUser
                    ? "Sign out of the current workspace session."
                    : "Open the sign-in page for a live workspace session."}
                </p>
              </div>
              {currentUser ? (
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
              ) : (
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleSignIn}>
                  <LogIn className="h-4 w-4" />
                  Sign In
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
