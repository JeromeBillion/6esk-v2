"use client";

import { Inter } from "next/font/google";
import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import BrandMark from "@/app/components/BrandMark";
import WavesCanvas from "@/app/components/landing/WavesCanvas";
import { useThemeMode } from "@/app/lib/theme";
import { Button } from "@/app/workspace/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/workspace/components/ui/card";

type PublicPageFrameProps = {
  title: string;
  description: string;
  children: ReactNode;
  maxWidthClassName?: string;
};

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"]
});

export default function PublicPageFrame({
  title,
  description,
  children,
  maxWidthClassName = "max-w-xl"
}: PublicPageFrameProps) {
  const { theme, toggleTheme } = useThemeMode();

  return (
    <div
      className={`${inter.className} relative min-h-screen overflow-hidden bg-[#07090d] px-6 py-10 text-white transition-colors`}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(88,125,255,0.12),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,18,28,0.72),_transparent_34%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,15,0.2)_0%,rgba(8,10,15,0.48)_100%)]" />
        <WavesCanvas
          lineColor="rgba(255,255,255,0.12)"
          backgroundColor="transparent"
          waveSpeedX={0.009}
          waveSpeedY={0.007}
          waveAmplitudeX={28}
          waveAmplitudeY={12}
          maxCursorMove={110}
          xGap={15}
          yGap={40}
        />
      </div>
      <div className={`relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] items-center ${maxWidthClassName}`}>
        <Card className="w-full border-border/60 bg-card/92 shadow-[0_24px_80px_rgba(0,0,0,0.36)] backdrop-blur-xl dark:bg-card/88 dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
          <CardHeader className="border-b border-border/80 pb-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <BrandMark size={34} priority />
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
