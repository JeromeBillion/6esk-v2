"use client";

import AppShell from "@/app/components/AppShell";
import { AnalyticsWorkspace } from "@/app/workspace/pages/AnalyticsWorkspace";

export default function AnalyticsClient() {
  return (
    <AppShell>
      <AnalyticsWorkspace />
    </AppShell>
  );
}
