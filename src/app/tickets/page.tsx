import { redirect } from "next/navigation";
import TicketsClient from "@/app/tickets/TicketsClient";
import { getSessionUser } from "@/server/auth/session";

export default async function TicketsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <TicketsClient />;
}
