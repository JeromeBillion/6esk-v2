import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";

export default async function HomePage() {
  const user = await getSessionUser();
  redirect(user ? "/tickets" : "/login");
}
