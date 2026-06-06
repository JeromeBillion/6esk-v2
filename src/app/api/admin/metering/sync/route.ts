import { syncPendingMeteringEvents } from "@/server/billing/metering-sync";

export async function POST(request: Request) {
  const secret = request.headers.get("x-6esk-secret");
  const expectedSecret = process.env.CALLS_OUTBOX_SECRET || process.env.INBOUND_SHARED_SECRET;
  
  if (!expectedSecret || secret !== expectedSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");
  const limit = Math.min(Math.max(Number(rawLimit) || 100, 1), 500);

  try {
    const result = await syncPendingMeteringEvents(limit);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
