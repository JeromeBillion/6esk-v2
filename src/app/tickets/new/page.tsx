import { redirect } from "next/navigation";
import NewTicketClient from "@/app/tickets/new/NewTicketClient";
import { getSessionUser } from "@/server/auth/session";
import { isServerDemoModeEnabled } from "@/server/demo-mode";

export default async function NewTicketPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  const demoModeEnabled = await isServerDemoModeEnabled(searchParams);
  if (!user && !demoModeEnabled) {
    redirect("/login");
  }

  return <NewTicketClient />;
}
