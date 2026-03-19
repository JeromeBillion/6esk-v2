"use client";

import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import BrandMark from "@/app/components/BrandMark";
import { useThemeMode } from "@/app/lib/theme";
import { Button } from "@/app/workspace/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/workspace/components/ui/card";

type PublicPageFrameProps = {
  title: string;
  description: string;
  children: ReactNode;
  maxWidthClassName?: string;
};

export default function PublicPageFrame({
  title,
  description,
  children,
  maxWidthClassName = "max-w-xl"
}: PublicPageFrameProps) {
  const { theme, toggleTheme } = useThemeMode();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(79,124,255,0.14),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(3,2,19,0.08),_transparent_30%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(126,165,255,0.16),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(8,10,16,0.82),_transparent_34%)] px-6 py-10 transition-colors">
      <div className={`mx-auto flex min-h-[calc(100vh-5rem)] items-center ${maxWidthClassName}`}>
        <Card className="w-full border-border/80 bg-card/95 shadow-[0_24px_80px_rgba(15,23,42,0.08)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur">
          <CardHeader className="border-b border-border/80 pb-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="rounded-2xl border border-border bg-secondary/50 p-3">
                  <BrandMark size={34} priority />
                </div>
                <div>
                  <CardTitle className="text-2xl text-foreground">{title}</CardTitle>
                  <CardDescription className="mt-1 text-sm text-muted-foreground">{description}</CardDescription>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={toggleTheme}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === "dark" ? "Light" : "Dark"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-6">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}
