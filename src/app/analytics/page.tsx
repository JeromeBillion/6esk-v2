import { redirect } from "next/navigation";
import AnalyticsClient from "@/app/analytics/AnalyticsClient";
import { getSessionUser } from "@/server/auth/session";

export default async function AnalyticsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <AnalyticsClient />;
}
