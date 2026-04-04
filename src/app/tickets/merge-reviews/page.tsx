import { redirect } from "next/navigation";
import MergeReviewsClient from "@/app/tickets/merge-reviews/MergeReviewsClient";
import { getSessionUser } from "@/server/auth/session";
import { isServerDemoModeEnabled } from "@/server/demo-mode";

export default async function MergeReviewsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  const demoModeEnabled = await isServerDemoModeEnabled(searchParams);
  if (!user && !demoModeEnabled) {
    redirect("/login");
  }

  return <MergeReviewsClient />;
}
