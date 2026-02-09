import { redirect } from "next/navigation";
import MailClient from "@/app/mail/MailClient";
import { getSessionUser } from "@/server/auth/session";

export default async function MailPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <MailClient />;
}
