import { NextRequest } from "next/server";
import { runSyncEngine } from "@/server/oauth/sync-engine";

export const maxDuration = 300; // Allow up to 5 minutes execution time on Vercel

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";

  if (!cronSecret && process.env.NODE_ENV === "production") {
    return new Response("Cron secret is not configured", { status: 503 });
  }

  // Basic security to ensure only authorized callers (like cron job service) can trigger this.
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    await runSyncEngine();
    return new Response("Sync engine executed successfully", { status: 200 });
  } catch (error) {
    console.error("[Sync Cron] Execution failed:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
