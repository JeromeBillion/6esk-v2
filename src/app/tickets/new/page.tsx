import { redirect } from "next/navigation";
import NewTicketClient from "@/app/tickets/new/NewTicketClient";
import { getSessionUser } from "@/server/auth/session";

export default async function NewTicketPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <NewTicketClient />;
}
