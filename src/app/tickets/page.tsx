import { redirect } from "next/navigation";
import TicketsClient from "@/app/tickets/TicketsClient";
import { getSessionUser } from "@/server/auth/session";
import { isServerDemoModeEnabled } from "@/server/demo-mode";

export default async function TicketsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  const demoModeEnabled = await isServerDemoModeEnabled(searchParams);
  if (!user && !demoModeEnabled) {
    redirect("/login");
  }

  return <TicketsClient />;
}
