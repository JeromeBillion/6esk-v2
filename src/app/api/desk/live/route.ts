import { getSessionUser } from "@/server/auth/session";
import { getDeskLiveSnapshot } from "@/server/desk/live";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getDeskLiveSnapshot(user);
  return Response.json(snapshot, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
