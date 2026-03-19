import { redirect } from "next/navigation";
import MergeReviewsClient from "@/app/tickets/merge-reviews/MergeReviewsClient";
import { getSessionUser } from "@/server/auth/session";

export default async function MergeReviewsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <MergeReviewsClient />;
}
