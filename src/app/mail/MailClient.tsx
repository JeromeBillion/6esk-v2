"use client";

import AppShell from "@/app/components/AppShell";
import { MailWorkspace } from "@/app/workspace/pages/MailWorkspace";

export default function MailClient() {
  return (
    <AppShell>
      <MailWorkspace />
    </AppShell>
  );
}
