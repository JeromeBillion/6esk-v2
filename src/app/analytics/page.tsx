import { redirect } from "next/navigation";
import AnalyticsClient from "@/app/analytics/AnalyticsClient";
import { getSessionUser } from "@/server/auth/session";
import { isServerDemoModeEnabled } from "@/server/demo-mode";

export default async function AnalyticsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  const demoModeEnabled = await isServerDemoModeEnabled(searchParams);
  if (!user && !demoModeEnabled) {
    redirect("/login");
  }

  return <AnalyticsClient />;
}
