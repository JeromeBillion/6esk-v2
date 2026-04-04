import { redirect } from "next/navigation";
import AdminClient from "@/app/admin/AdminClient";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { isServerDemoModeEnabled } from "@/server/demo-mode";

export default async function AdminPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  const demoModeEnabled = await isServerDemoModeEnabled(searchParams);
  if (!user && !demoModeEnabled) {
    redirect("/login");
  }

  if (user && !demoModeEnabled && !isLeadAdmin(user)) {
    redirect("/mail");
  }

  return <AdminClient />;
}
