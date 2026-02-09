import { redirect } from "next/navigation";
import AdminClient from "@/app/admin/AdminClient";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
  }

  if (!isLeadAdmin(user)) {
    redirect("/mail");
  }

  return <AdminClient />;
}
