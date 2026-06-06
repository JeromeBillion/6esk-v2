import { clearSession } from "@/server/auth/session";

export async function POST() {
  await clearSession();
  return Response.json({ status: "ok" });
}
