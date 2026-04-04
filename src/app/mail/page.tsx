import { redirect } from "next/navigation";
import MailClient from "@/app/mail/MailClient";
import { getSessionUser } from "@/server/auth/session";
import { isServerDemoModeEnabled } from "@/server/demo-mode";

export default async function MailPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  const demoModeEnabled = await isServerDemoModeEnabled(searchParams);
  if (!user && !demoModeEnabled) {
    redirect("/login");
  }

  return <MailClient />;
}
